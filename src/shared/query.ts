import {
	isEffectivelyEmptyInterface,
	isEffectivelyEmptyTypeLiteral,
	isUnappliedReferenceTo,
	onlyTypeArgument,
	TRANSPARENT_WRAPPERS,
	typeArgumentList,
	typeReferenceName,
	unwrapTransparentType,
} from '@anti-slop/shared/transparent-type';
import type { ESTree } from '@oxlint/plugins';
import { match, P } from 'ts-pattern';

export type UnsafeValue = 'any' | 'empty-object' | 'object' | 'union' | 'unknown';

export type UnsafeDictionary = {
	readonly kind: 'unsafe-dictionary';
	readonly unsafeValue: UnsafeValue;
};

export type WideningTargetKind =
	| 'anonymous object'
	| 'generic container'
	| 'object'
	| 'open dictionary'
	| 'unknown';

export type WideningTarget = {
	readonly kind: WideningTargetKind;
};

type Environment = {
	readonly aliases: ReadonlyMap<string, ESTree.TSTypeAliasDeclaration>;
	readonly interfaces: ReadonlyMap<string, readonly ESTree.TSInterfaceDeclaration[]>;
	isBuiltIn(name: string): boolean;
};

type TypeAliasEnvironment = ReadonlyMap<string, ESTree.TSType>;
type WideningOrigin = 'alias' | 'surface';

type ResolvedType = {
	readonly type: ESTree.TSType;
	readonly substitutions: TypeAliasEnvironment;
};

type AliasFrame = {
	readonly alias: ESTree.TSTypeAliasDeclaration;
	readonly query: TypeQuery;
};

function resolvedSubstitutionArgument(
	type: ESTree.TSType,
	base: TypeAliasEnvironment,
	resolving: ReadonlySet<string> = new Set(),
): ESTree.TSType {
	const unwrapped = unwrapTransparentType(type);
	return match(unwrapped)
		.with({ type: 'TSTypeReference' }, (reference) => {
			const name = typeReferenceName(reference);
			return match(name)
				.with(P.nullish, () => type)
				.when(
					(bound) => resolving.has(bound),
					() => type,
				)
				.otherwise((bound) =>
					match(base.get(bound))
						.with(P.nullish, () => type)
						.otherwise((resolved) =>
							resolvedSubstitutionArgument(resolved, base, new Set([...resolving, bound])),
						),
				);
		})
		.otherwise(() => type);
}

export class TypeQuery {
	private readonly environment: Environment;
	private readonly substitutions: TypeAliasEnvironment;
	private readonly resolving: ReadonlySet<string>;

	constructor(
		environment: Environment,
		substitutions: TypeAliasEnvironment,
		resolving: ReadonlySet<string>,
	) {
		this.environment = environment;
		this.substitutions = substitutions;
		this.resolving = resolving;
	}

	classifyUnsafe(type: ESTree.TSType): UnsafeDictionary | null {
		return this.firstUnsafe(this.dictionaryValues(type));
	}

	classifyUnsafeValue(type: ESTree.TSType): UnsafeDictionary | null {
		return match(this.unsafeDirect(type))
			.with(P.nullish, () => null)
			.otherwise((unsafeValue) => ({ kind: 'unsafe-dictionary', unsafeValue }));
	}

	classifyWidening(type: ESTree.TSType, origin: WideningOrigin): WideningTarget | null {
		return match(unwrapTransparentType(type))
			.returnType<WideningTarget | null>()
			.with({ type: 'TSUnknownKeyword' }, () => ({ kind: 'unknown' }))
			.with({ type: 'TSObjectKeyword' }, () => ({ kind: 'object' }))
			.with({ type: 'TSTypeLiteral' }, ({ members }) => this.wideningLiteral(members, origin))
			.with({ type: 'TSMappedType' }, (mapped) => this.wideningMapped(mapped, origin))
			.with({ type: 'TSTypeReference' }, (reference) => this.wideningReference(reference, origin))
			.otherwise(() => null);
	}

	private withSubstitutions(substitutions: TypeAliasEnvironment): TypeQuery {
		return new TypeQuery(this.environment, substitutions, new Set());
	}

	private enter(name: string, reference: ESTree.TSTypeReference): AliasFrame | null {
		return match(this.environment.aliases.get(name))
			.returnType<AliasFrame | null>()
			.with(P.nullish, () => null)
			.otherwise((alias) =>
				match(this.resolving.has(name))
					.with(true, () => null)
					.with(false, () =>
						match(this.bindAlias(alias, reference))
							.with(P.nullish, () => null)
							.otherwise((substitutions) => ({
								alias,
								query: new TypeQuery(
									this.environment,
									substitutions,
									new Set([...this.resolving, name]),
								),
							})),
					)
					.exhaustive(),
			);
	}

	private bindAlias(
		alias: ESTree.TSTypeAliasDeclaration,
		reference: ESTree.TSTypeReference,
	): TypeAliasEnvironment | null {
		const parameters = alias.typeParameters?.params ?? [];
		const applied = reference.typeArguments?.params ?? [];
		return this.bindParameters(parameters, applied, 0, new Map(this.substitutions));
	}

	private bindParameters(
		parameters: readonly ESTree.TSTypeParameter[],
		applied: readonly ESTree.TSType[],
		index: number,
		next: Map<string, ESTree.TSType>,
	): TypeAliasEnvironment | null {
		return match(parameters[index])
			.with(P.nullish, () => next)
			.otherwise((parameter) =>
				match(applied[index] ?? parameter.default)
					.with(P.nullish, () => null)
					.otherwise((present) => {
						next.set(parameter.name.name, resolvedSubstitutionArgument(present, next));
						return this.bindParameters(parameters, applied, index + 1, next);
					}),
			);
	}

	private firstUnsafe(values: readonly ResolvedType[]): UnsafeDictionary | null {
		return match(values)
			.with([], () => null)
			.otherwise(([first, ...rest]) =>
				match(first)
					.with(P.nullish, () => this.firstUnsafe(rest))
					.otherwise((value) =>
						match(this.withSubstitutions(value.substitutions).unsafeDirect(value.type))
							.with(P.nullish, () => this.firstUnsafe(rest))
							.otherwise((unsafeValue) => ({ kind: 'unsafe-dictionary', unsafeValue })),
					),
			);
	}

	private unsafeDirect(type: ESTree.TSType): UnsafeValue | null {
		return match(unwrapTransparentType(type))
			.returnType<UnsafeValue | null>()
			.with({ type: 'TSUnknownKeyword' }, () => 'unknown')
			.with({ type: 'TSAnyKeyword' }, () => 'any')
			.with({ type: 'TSObjectKeyword' }, () => 'object')
			.with({ type: 'TSTypeLiteral' }, (literal) =>
				isEffectivelyEmptyTypeLiteral(literal) ? 'empty-object' : null,
			)
			.with({ type: 'TSUnionType' }, (union) => this.unsafeUnion(union))
			.with({ type: 'TSIntersectionType' }, (intersection) => this.unsafeIntersection(intersection))
			.with({ type: 'TSTypeReference' }, (reference) => this.unsafeReference(reference))
			.otherwise(() => null);
	}

	private unsafeUnion(type: ESTree.TSUnionType): UnsafeValue | null {
		return match(
			type.types.find((member) =>
				match(this.unsafeDirect(member))
					.with(P.nullish, () => false)
					.otherwise(() => true),
			),
		)
			.with(P.nullish, () => null)
			.otherwise(() => 'union');
	}

	private unsafeIntersection(type: ESTree.TSIntersectionType): UnsafeValue | null {
		const unsafeMembers = type.types.map((member) => this.unsafeDirect(member));
		return match(unsafeMembers)
			.returnType<UnsafeValue | null>()
			.when(
				(members) => members.includes('any'),
				() => 'any',
			)
			.with([P.nonNullable, ...P.array(P.nonNullable)], ([first]) => first)
			.otherwise(() => null);
	}

	private unsafeReference(reference: ESTree.TSTypeReference): UnsafeValue | null {
		return match(typeReferenceName(reference))
			.with(P.nullish, () => null)
			.otherwise((typeName) =>
				match({
					wrapper: TRANSPARENT_WRAPPERS.has(typeName) && this.environment.isBuiltIn(typeName),
					inner: onlyTypeArgument(reference),
				})
					.returnType<UnsafeValue | null>()
					.with({ wrapper: true, inner: P.nonNullable }, ({ inner }) => this.unsafeDirect(inner))
					.otherwise(() => this.unsafeNamed(typeName, reference)),
			);
	}

	private unsafeNamed(typeName: string, reference: ESTree.TSTypeReference): UnsafeValue | null {
		return match(this.substitutions.get(typeName))
			.with(P.nonNullable, (resolved) =>
				isUnappliedReferenceTo(resolved, typeName) ? null : this.unsafeDirect(resolved),
			)
			.otherwise(() =>
				match(this.environment.interfaces.get(typeName))
					.with(P.nonNullable, (declarations) =>
						isEffectivelyEmptyInterface(declarations) ? 'empty-object' : null,
					)
					.otherwise(() =>
						match(this.enter(typeName, reference))
							.with(P.nullish, () => null)
							.otherwise(({ alias, query }) => query.unsafeDirect(alias.typeAnnotation)),
					),
			);
	}

	private dictionaryValues(type: ESTree.TSType): readonly ResolvedType[] {
		return match(unwrapTransparentType(type))
			.returnType<readonly ResolvedType[]>()
			.with({ type: 'TSTypeLiteral' }, (literal) =>
				literal.members.flatMap((member): readonly ResolvedType[] =>
					match(member)
						.with({ type: 'TSIndexSignature', typeAnnotation: P.nonNullable }, (index) => [
							{ type: index.typeAnnotation.typeAnnotation, substitutions: this.substitutions },
						])
						.otherwise(() => []),
				),
			)
			.with({ type: 'TSMappedType', typeAnnotation: P.nonNullable }, (mapped) => [
				{ type: mapped.typeAnnotation, substitutions: this.substitutions },
			])
			.with({ type: 'TSTypeReference' }, (reference) =>
				this.dictionaryValuesFromReference(reference),
			)
			.otherwise(() => []);
	}

	private dictionaryValuesFromReference(
		reference: ESTree.TSTypeReference,
	): readonly ResolvedType[] {
		return match(typeReferenceName(reference))
			.with(P.nullish, () => [])
			.otherwise((typeName) =>
				match(this.substitutions.get(typeName))
					.with(P.nonNullable, (resolved) =>
						isUnappliedReferenceTo(resolved, typeName) ? [] : this.dictionaryValues(resolved),
					)
					.otherwise(() => this.dictionaryValuesFromNamedType(typeName, reference)),
			);
	}

	private dictionaryValuesFromNamedType(
		name: string,
		reference: ESTree.TSTypeReference,
	): readonly ResolvedType[] {
		return match({
			name,
			params: typeArgumentList(reference),
			builtin: this.environment.isBuiltIn(name),
		})
			.with(
				{
					builtin: true,
					name: P.union('Readonly', 'Partial', 'Required', 'NonNullable'),
					params: [P.select()],
				},
				(inner) => this.dictionaryValues(inner),
			)
			.with({ builtin: true, name: 'Record', params: [P._, P.select()] }, (value) => [
				{ type: value, substitutions: this.substitutions },
			])
			.with({ builtin: true, name: P.union('Pick', 'Omit'), params: [P.select(), P._] }, (source) =>
				this.dictionaryValues(source),
			)
			.otherwise(() =>
				match(this.enter(name, reference))
					.with(P.nullish, () => [])
					.otherwise(({ alias, query }) => query.dictionaryValues(alias.typeAnnotation)),
			);
	}

	private wideningLiteral(
		members: readonly ESTree.TSSignature[],
		origin: WideningOrigin,
	): WideningTarget | null {
		return match({ origin, members })
			.returnType<WideningTarget | null>()
			.when(
				({ members: items }) => items.some((member) => member.type === 'TSIndexSignature'),
				() => ({ kind: 'open dictionary' }),
			)
			.with({ origin: 'surface', members: [] }, () => null)
			.with({ origin: 'surface' }, () => ({ kind: 'anonymous object' }))
			.otherwise(() => null);
	}

	private wideningMapped(
		mapped: ESTree.TSMappedType,
		origin: WideningOrigin,
	): WideningTarget | null {
		return match(origin)
			.returnType<WideningTarget | null>()
			.with('surface', () => ({ kind: 'open dictionary' }))
			.with('alias', () =>
				this.isBroadMappedKey(mapped.constraint) ? { kind: 'open dictionary' } : null,
			)
			.exhaustive();
	}

	private wideningReference(
		reference: ESTree.TSTypeReference,
		origin: WideningOrigin,
	): WideningTarget | null {
		return match(typeReferenceName(reference))
			.with(P.nullish, () => null)
			.otherwise((typeName) =>
				match(origin)
					.with('alias', () => this.wideningThroughSubstitution(typeName, reference))
					.with('surface', () => this.wideningNamed(typeName, reference, origin))
					.exhaustive(),
			);
	}

	private wideningThroughSubstitution(
		typeName: string,
		reference: ESTree.TSTypeReference,
	): WideningTarget | null {
		return match(this.substitutions.get(typeName))
			.with(P.nullish, () => this.wideningNamed(typeName, reference, 'alias'))
			.when(
				(resolved) => isUnappliedReferenceTo(resolved, typeName),
				() => null,
			)
			.otherwise((resolved) => this.classifyWidening(resolved, 'alias'));
	}

	private wideningNamed(
		typeName: string,
		reference: ESTree.TSTypeReference,
		origin: WideningOrigin,
	): WideningTarget | null {
		return match({
			name: typeName,
			builtin: this.environment.isBuiltIn(typeName),
			inner: onlyTypeArgument(reference),
		})
			.returnType<WideningTarget | null>()
			.with(
				{
					builtin: true,
					name: P.union('Readonly', 'Partial', 'Required', 'NonNullable'),
					inner: P.nonNullable,
				},
				({ inner }) => this.classifyWidening(inner, origin),
			)
			.with({ builtin: true, name: 'Record' }, () => ({ kind: 'open dictionary' }))
			.otherwise(() =>
				match(this.enter(typeName, reference))
					.with(P.nullish, () => null)
					.otherwise((frame) => this.wideningAlias(frame, origin)),
			);
	}

	private wideningAlias(frame: AliasFrame, origin: WideningOrigin): WideningTarget | null {
		const parameters = frame.alias.typeParameters?.params ?? [];
		return match({ origin, generic: parameters.length > 0 })
			.returnType<WideningTarget | null>()
			.with({ origin: 'surface', generic: true }, () =>
				match(frame.query.dictionaryValues(frame.alias.typeAnnotation).length > 0)
					.returnType<WideningTarget | null>()
					.with(true, () => ({ kind: 'generic container' }))
					.with(false, () => null)
					.exhaustive(),
			)
			.otherwise(() => frame.query.classifyWidening(frame.alias.typeAnnotation, 'alias'));
	}

	private isBroadMappedKey(type: ESTree.TSType): boolean {
		return match(unwrapTransparentType(type))
			.with({ type: P.union('TSStringKeyword', 'TSNumberKeyword', 'TSSymbolKeyword') }, () => true)
			.with({ type: 'TSUnionType' }, (union) =>
				union.types.every((member) => this.isBroadMappedKey(member)),
			)
			.with({ type: 'TSTypeReference' }, (reference) => this.isBroadMappedKeyReference(reference))
			.otherwise(() => false);
	}

	private isBroadMappedKeyReference(reference: ESTree.TSTypeReference): boolean {
		return match(typeReferenceName(reference))
			.with(P.nullish, () => false)
			.otherwise((typeName) =>
				match(this.substitutions.get(typeName))
					.with(P.nullish, () => this.isPropertyKey(typeName))
					.when(
						(resolved) => isUnappliedReferenceTo(resolved, typeName),
						() => this.isPropertyKey(typeName),
					)
					.otherwise((resolved) => this.isBroadMappedKey(resolved)),
			);
	}

	private isPropertyKey(typeName: string): boolean {
		return typeName === 'PropertyKey' && this.environment.isBuiltIn(typeName);
	}
}
