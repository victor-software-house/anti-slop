import type { ESTree } from '@oxlint/plugins';
import { match, P } from 'ts-pattern';

const BUILT_INS = new Set([
	'Record',
	'Readonly',
	'Partial',
	'Required',
	'Pick',
	'Omit',
	'PropertyKey',
	'NonNullable',
]);
const TRANSPARENT_WRAPPERS = new Set(['Readonly', 'Partial', 'Required', 'NonNullable']);

type TypeAliasEnvironment = ReadonlyMap<string, ESTree.TSType>;

type ResolvedType = {
	readonly type: ESTree.TSType;
	readonly substitutions: TypeAliasEnvironment;
};

export type UnsafeDictionary = {
	readonly kind: 'unsafe-dictionary';
	readonly unsafeValue: 'any' | 'empty-object' | 'object' | 'union' | 'unknown';
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

export type TypeEnvironment = {
	readonly aliases: ReadonlyMap<string, ESTree.TSTypeAliasDeclaration>;
	readonly interfaces: ReadonlyMap<string, readonly ESTree.TSInterfaceDeclaration[]>;
	readonly shadowedBuiltIns: ReadonlySet<string>;
};

function declaredStatement(statement: ESTree.Statement): ESTree.Node | null {
	return match(statement)
		.with(
			{ type: P.union('ExportNamedDeclaration', 'ExportDefaultDeclaration') },
			({ declaration }) => declaration ?? null,
		)
		.otherwise((value) => value);
}

export function createTypeEnvironment(program: ESTree.Program): TypeEnvironment {
	const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();
	const interfaces = new Map<string, ESTree.TSInterfaceDeclaration[]>();
	const shadowedBuiltIns = new Set<string>();

	for (const statement of program.body) {
		recordProgramDeclaration(declaredStatement(statement), aliases, interfaces, shadowedBuiltIns);
	}

	return { aliases, interfaces, shadowedBuiltIns };
}

function shadowIfBuiltIn(name: string, shadowedBuiltIns: Set<string>): void {
	if (BUILT_INS.has(name)) shadowedBuiltIns.add(name);
}

function recordProgramDeclaration(
	declaration: ESTree.Node | null,
	aliases: Map<string, ESTree.TSTypeAliasDeclaration>,
	interfaces: Map<string, ESTree.TSInterfaceDeclaration[]>,
	shadowedBuiltIns: Set<string>,
): void {
	match(declaration)
		.with(P.nullish, () => undefined)
		.with({ type: 'ImportDeclaration' }, ({ specifiers }) => {
			for (const specifier of specifiers) {
				shadowIfBuiltIn(specifier.local.name, shadowedBuiltIns);
			}
		})
		.with({ type: 'TSTypeAliasDeclaration' }, (alias) => {
			const existing = aliases.get(alias.id.name);
			match(existing)
				.with(P.nullish, () => {
					aliases.set(alias.id.name, alias);
				})
				.otherwise(() => {
					shadowedBuiltIns.add(alias.id.name);
				});
			shadowIfBuiltIn(alias.id.name, shadowedBuiltIns);
		})
		.with({ type: 'TSInterfaceDeclaration' }, (iface) => {
			const declarations = interfaces.get(iface.id.name) ?? [];
			declarations.push(iface);
			interfaces.set(iface.id.name, declarations);
			shadowIfBuiltIn(iface.id.name, shadowedBuiltIns);
		})
		.with({ type: 'TSEnumDeclaration' }, (enumDecl) => {
			shadowIfBuiltIn(enumDecl.id.name, shadowedBuiltIns);
		})
		.with(
			{ type: P.union('ClassDeclaration', 'FunctionDeclaration'), id: P.nonNullable },
			({ id }) => {
				shadowIfBuiltIn(id.name, shadowedBuiltIns);
			},
		)
		.otherwise(() => undefined);
}

function typeReferenceName(type: ESTree.TSTypeReference): string | null {
	return match(type.typeName)
		.with({ type: 'Identifier' }, ({ name }) => name)
		.otherwise(() => null);
}

function isBuiltIn(name: string, environment: TypeEnvironment): boolean {
	return BUILT_INS.has(name) && !environment.shadowedBuiltIns.has(name);
}

function isUnappliedReferenceTo(type: ESTree.TSType, name: string): boolean {
	return match(unwrapTransparentType(type))
		.with(
			{
				type: 'TSTypeReference',
				typeName: { type: 'Identifier', name },
				typeArguments: P.union(P.nullish, { params: [] }),
			},
			() => true,
		)
		.otherwise(() => false);
}

function typeArgumentList(reference: ESTree.TSTypeReference): readonly ESTree.TSType[] {
	return reference.typeArguments?.params ?? [];
}

function onlyTypeArgument(reference: ESTree.TSTypeReference): ESTree.TSType | null {
	return match(typeArgumentList(reference))
		.with([P.select()], (type) => type)
		.otherwise(() => null);
}

function unwrapTransparentType(type: ESTree.TSType): ESTree.TSType {
	return match(type)
		.with({ type: 'TSParenthesizedType' }, ({ typeAnnotation }) =>
			unwrapTransparentType(typeAnnotation),
		)
		.with({ type: 'TSTypeOperator', operator: 'readonly' }, ({ typeAnnotation }) =>
			unwrapTransparentType(typeAnnotation),
		)
		.otherwise((current) => current);
}

function isNeverType(type: ESTree.TSType): boolean {
	return match(unwrapTransparentType(type))
		.with({ type: 'TSNeverKeyword' }, () => true)
		.otherwise(() => false);
}

function isEffectivelyEmptyMember(member: ESTree.TSSignature): boolean {
	return match(member)
		.with(
			{
				type: 'TSPropertySignature',
				optional: true,
				typeAnnotation: P.nonNullable,
			},
			({ typeAnnotation }) => isNeverType(typeAnnotation.typeAnnotation),
		)
		.otherwise(() => false);
}

function isEffectivelyEmptyTypeLiteral(type: ESTree.TSTypeLiteral): boolean {
	return type.members.length === 0 || type.members.every(isEffectivelyEmptyMember);
}

function isEffectivelyEmptyInterface(
	declarations: readonly ESTree.TSInterfaceDeclaration[],
): boolean {
	return match(declarations)
		.with(
			[P.select()],
			(type) =>
				type.extends.length === 0 &&
				(type.body.body.length === 0 || type.body.body.every(isEffectivelyEmptyMember)),
		)
		.otherwise(() => false);
}

function resolvedSubstitutionArgument(
	type: ESTree.TSType,
	base: TypeAliasEnvironment,
	resolving: ReadonlySet<string> = new Set(),
): ESTree.TSType {
	const unwrapped = unwrapTransparentType(type);
	return match(unwrapped)
		.with({ type: 'TSTypeReference' }, (reference) => {
			const name = typeReferenceName(reference);
			if (name === null || resolving.has(name)) return type;
			const substitution = base.get(name);
			return match(substitution)
				.with(P.nullish, () => type)
				.otherwise((resolved) => {
					const nextResolving = new Set(resolving);
					nextResolving.add(name);
					return resolvedSubstitutionArgument(resolved, base, nextResolving);
				});
		})
		.otherwise(() => type);
}

function aliasSubstitution(
	alias: ESTree.TSTypeAliasDeclaration,
	type: ESTree.TSTypeReference,
	base: TypeAliasEnvironment,
): TypeAliasEnvironment | null {
	const parameters = alias.typeParameters?.params ?? [];
	const appliedArguments = type.typeArguments?.params ?? [];
	const next = new Map(base);
	for (const [index, parameter] of parameters.entries()) {
		const argument = appliedArguments[index] ?? parameter.default;
		if (argument === null || argument === undefined) return null;
		next.set(parameter.name.name, resolvedSubstitutionArgument(argument, next));
	}
	return next;
}

function unsafeDirectValue(
	type: ESTree.TSType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): UnsafeDictionary['unsafeValue'] | null {
	return match(unwrapTransparentType(type))
		.returnType<UnsafeDictionary['unsafeValue'] | null>()
		.with({ type: 'TSUnknownKeyword' }, () => 'unknown')
		.with({ type: 'TSAnyKeyword' }, () => 'any')
		.with({ type: 'TSObjectKeyword' }, () => 'object')
		.with({ type: 'TSTypeLiteral' }, (literal) =>
			isEffectivelyEmptyTypeLiteral(literal) ? 'empty-object' : null,
		)
		.with({ type: 'TSUnionType' }, (union) =>
			unsafeUnionValue(union, environment, substitutions, resolvingAliases),
		)
		.with({ type: 'TSIntersectionType' }, (intersection) =>
			unsafeIntersectionValue(intersection, environment, substitutions, resolvingAliases),
		)
		.with({ type: 'TSTypeReference' }, (reference) =>
			unsafeTypeReferenceValue(reference, environment, substitutions, resolvingAliases),
		)
		.otherwise(() => null);
}

function unsafeUnionValue(
	type: ESTree.TSUnionType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): UnsafeDictionary['unsafeValue'] | null {
	return type.types.some(
		(member) => unsafeDirectValue(member, environment, substitutions, resolvingAliases) !== null,
	)
		? 'union'
		: null;
}

function unsafeIntersectionValue(
	type: ESTree.TSIntersectionType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): UnsafeDictionary['unsafeValue'] | null {
	const unsafeMembers = type.types.map((member) =>
		unsafeDirectValue(member, environment, substitutions, resolvingAliases),
	);
	return match(unsafeMembers)
		.returnType<UnsafeDictionary['unsafeValue'] | null>()
		.when(
			(members) => members.includes('any'),
			() => 'any',
		)
		.when(
			(members) => members.length > 0 && members.every((member) => member !== null),
			(members) => members[0] ?? null,
		)
		.otherwise(() => null);
}

function unsafeTypeReferenceValue(
	unwrapped: ESTree.TSTypeReference,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): UnsafeDictionary['unsafeValue'] | null {
	const name = typeReferenceName(unwrapped);
	return match(name)
		.with(P.nullish, () => null)
		.otherwise((typeName) => {
			if (TRANSPARENT_WRAPPERS.has(typeName) && isBuiltIn(typeName, environment)) {
				return match(onlyTypeArgument(unwrapped))
					.with(P.nullish, () => null)
					.otherwise((inner) =>
						unsafeDirectValue(inner, environment, substitutions, resolvingAliases),
					);
			}
			const substitution = substitutions.get(typeName);
			return match(substitution)
				.with(P.nonNullable, (resolved) =>
					isUnappliedReferenceTo(resolved, typeName)
						? null
						: unsafeDirectValue(resolved, environment, substitutions, resolvingAliases),
				)
				.otherwise(() => {
					const interfaceDeclarations = environment.interfaces.get(typeName);
					return match(interfaceDeclarations)
						.with(P.nonNullable, (declarations) =>
							isEffectivelyEmptyInterface(declarations) ? 'empty-object' : null,
						)
						.otherwise(() => {
							const alias = environment.aliases.get(typeName);
							if (alias === undefined || resolvingAliases.has(typeName)) return null;
							const nextSubstitutions = aliasSubstitution(alias, unwrapped, substitutions);
							if (nextSubstitutions === null) return null;
							const nextResolving = new Set(resolvingAliases);
							nextResolving.add(typeName);
							return unsafeDirectValue(
								alias.typeAnnotation,
								environment,
								nextSubstitutions,
								nextResolving,
							);
						});
				});
		});
}

function dictionaryValueTypes(
	type: ESTree.TSType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): readonly ResolvedType[] {
	return match(unwrapTransparentType(type))
		.returnType<readonly ResolvedType[]>()
		.with({ type: 'TSTypeLiteral' }, (literal) =>
			literal.members.flatMap((member): readonly ResolvedType[] =>
				match(member)
					.with({ type: 'TSIndexSignature', typeAnnotation: P.nonNullable }, (index) => [
						{ type: index.typeAnnotation.typeAnnotation, substitutions },
					])
					.otherwise(() => []),
			),
		)
		.with({ type: 'TSMappedType', typeAnnotation: P.nonNullable }, (mapped) => [
			{ type: mapped.typeAnnotation, substitutions },
		])
		.with({ type: 'TSTypeReference' }, (reference) =>
			dictionaryValueTypesFromReference(reference, environment, substitutions, resolvingAliases),
		)
		.otherwise(() => []);
}

function dictionaryValueTypesFromReference(
	unwrapped: ESTree.TSTypeReference,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): readonly ResolvedType[] {
	const name = typeReferenceName(unwrapped);
	return match(name)
		.with(P.nullish, () => [])
		.otherwise((typeName) => {
			const substitution = substitutions.get(typeName);
			return match(substitution)
				.with(P.nonNullable, (resolved) =>
					isUnappliedReferenceTo(resolved, typeName)
						? []
						: dictionaryValueTypes(resolved, environment, substitutions, resolvingAliases),
				)
				.otherwise(() =>
					dictionaryValueTypesFromNamedType(
						typeName,
						unwrapped,
						environment,
						substitutions,
						resolvingAliases,
					),
				);
		});
}

function dictionaryValueTypesFromNamedType(
	name: string,
	unwrapped: ESTree.TSTypeReference,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): readonly ResolvedType[] {
	const fromAlias = (): readonly ResolvedType[] => {
		const alias = environment.aliases.get(name);
		if (alias === undefined || resolvingAliases.has(name)) return [];
		const nextSubstitutions = aliasSubstitution(alias, unwrapped, substitutions);
		if (nextSubstitutions === null) return [];
		const nextResolving = new Set(resolvingAliases);
		nextResolving.add(name);
		return dictionaryValueTypes(
			alias.typeAnnotation,
			environment,
			nextSubstitutions,
			nextResolving,
		);
	};

	return match({ name, params: typeArgumentList(unwrapped), builtin: isBuiltIn(name, environment) })
		.with(
			{
				builtin: true,
				name: P.union('Readonly', 'Partial', 'Required', 'NonNullable'),
				params: [P.select()],
			},
			(inner) => dictionaryValueTypes(inner, environment, substitutions, resolvingAliases),
		)
		.with({ builtin: true, name: 'Record', params: [P._, P.select()] }, (value) => [
			{ type: value, substitutions },
		])
		.with({ builtin: true, name: P.union('Pick', 'Omit'), params: [P.select(), P._] }, (source) =>
			dictionaryValueTypes(source, environment, substitutions, resolvingAliases),
		)
		.otherwise(fromAlias);
}

export function classifyUnsafeDictionaryValue(
	valueType: ESTree.TSType,
	environment: TypeEnvironment,
): UnsafeDictionary | null {
	const unsafeValue = unsafeDirectValue(valueType, environment, new Map(), new Set());
	return unsafeValue === null ? null : { kind: 'unsafe-dictionary', unsafeValue };
}

export function classifyUnsafeDictionary(
	type: ESTree.TSType,
	environment: TypeEnvironment,
): UnsafeDictionary | null {
	for (const valueType of dictionaryValueTypes(type, environment, new Map(), new Set())) {
		const unsafeValue = unsafeDirectValue(
			valueType.type,
			environment,
			valueType.substitutions,
			new Set(),
		);
		if (unsafeValue !== null) return { kind: 'unsafe-dictionary', unsafeValue };
	}
	return null;
}

function resolvesToDictionary(
	type: ESTree.TSType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): boolean {
	return dictionaryValueTypes(type, environment, substitutions, resolvingAliases).length > 0;
}

export function classifyWideningTarget(
	type: ESTree.TSType,
	environment: TypeEnvironment,
): WideningTarget | null {
	return match(unwrapTransparentType(type))
		.returnType<WideningTarget | null>()
		.with({ type: 'TSUnknownKeyword' }, () => ({ kind: 'unknown' }))
		.with({ type: 'TSObjectKeyword' }, () => ({ kind: 'object' }))
		.with({ type: 'TSTypeLiteral' }, ({ members }) =>
			match(members)
				.returnType<WideningTarget | null>()
				.with([], () => null)
				.when(
					(items) => items.some((member) => member.type === 'TSIndexSignature'),
					() => ({ kind: 'open dictionary' }),
				)
				.otherwise(() => ({ kind: 'anonymous object' })),
		)
		.with({ type: 'TSMappedType' }, () => ({ kind: 'open dictionary' }))
		.with({ type: 'TSTypeReference' }, (reference) =>
			classifyWideningTypeReference(reference, environment),
		)
		.otherwise(() => null);
}

function classifyWideningTypeReference(
	unwrapped: ESTree.TSTypeReference,
	environment: TypeEnvironment,
): WideningTarget | null {
	const name = typeReferenceName(unwrapped);
	return match(name)
		.with(P.nullish, () => null)
		.otherwise((typeName) => {
			if (TRANSPARENT_WRAPPERS.has(typeName) && isBuiltIn(typeName, environment)) {
				return match(onlyTypeArgument(unwrapped))
					.with(P.nullish, () => null)
					.otherwise((inner) => classifyWideningTarget(inner, environment));
			}
			if (typeName === 'Record' && isBuiltIn(typeName, environment)) {
				return { kind: 'open dictionary' };
			}
			const alias = environment.aliases.get(typeName);
			return match(alias)
				.with(P.nullish, () => null)
				.otherwise((resolvedAlias) => {
					if ((resolvedAlias.typeParameters?.params.length ?? 0) > 0) {
						const substitutions = aliasSubstitution(resolvedAlias, unwrapped, new Map());
						return substitutions !== null &&
							resolvesToDictionary(
								resolvedAlias.typeAnnotation,
								environment,
								substitutions,
								new Set([typeName]),
							)
							? { kind: 'generic container' }
							: null;
					}
					const substitutions = aliasSubstitution(resolvedAlias, unwrapped, new Map());
					return match(substitutions)
						.with(P.nullish, () => null)
						.otherwise((next) =>
							classifyAliasBroadTarget(
								resolvedAlias.typeAnnotation,
								environment,
								next,
								new Set([typeName]),
							),
						);
				});
		});
}

function isBroadMappedKey(
	type: ESTree.TSType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
): boolean {
	return match(unwrapTransparentType(type))
		.with({ type: P.union('TSStringKeyword', 'TSNumberKeyword', 'TSSymbolKeyword') }, () => true)
		.with({ type: 'TSUnionType' }, (union) =>
			union.types.every((member) => isBroadMappedKey(member, environment, substitutions)),
		)
		.with({ type: 'TSTypeReference' }, (reference) => {
			const name = typeReferenceName(reference);
			return match(name)
				.with(P.nullish, () => false)
				.otherwise((typeName) => {
					const substitution = substitutions.get(typeName);
					if (substitution !== undefined && !isUnappliedReferenceTo(substitution, typeName)) {
						return isBroadMappedKey(substitution, environment, substitutions);
					}
					return typeName === 'PropertyKey' && isBuiltIn(typeName, environment);
				});
		})
		.otherwise(() => false);
}

function classifyAliasBroadTarget(
	type: ESTree.TSType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): WideningTarget | null {
	return match(unwrapTransparentType(type))
		.returnType<WideningTarget | null>()
		.with({ type: 'TSUnknownKeyword' }, () => ({ kind: 'unknown' }))
		.with({ type: 'TSObjectKeyword' }, () => ({ kind: 'object' }))
		.with({ type: 'TSTypeLiteral' }, ({ members }) =>
			match(members)
				.returnType<WideningTarget | null>()
				.when(
					(items) => items.some((member) => member.type === 'TSIndexSignature'),
					() => ({ kind: 'open dictionary' }),
				)
				.otherwise(() => null),
		)
		.with({ type: 'TSMappedType' }, (mapped) =>
			isBroadMappedKey(mapped.constraint, environment, substitutions)
				? { kind: 'open dictionary' }
				: null,
		)
		.with({ type: 'TSTypeReference' }, (reference) =>
			classifyAliasBroadTypeReference(reference, environment, substitutions, resolvingAliases),
		)
		.otherwise(() => null);
}

function classifyAliasBroadTypeReference(
	unwrapped: ESTree.TSTypeReference,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): WideningTarget | null {
	const name = typeReferenceName(unwrapped);
	return match(name)
		.with(P.nullish, () => null)
		.otherwise((typeName) => {
			const substitution = substitutions.get(typeName);
			return match(substitution)
				.with(P.nonNullable, (resolved) =>
					isUnappliedReferenceTo(resolved, typeName)
						? null
						: classifyAliasBroadTarget(resolved, environment, substitutions, resolvingAliases),
				)
				.otherwise(() => {
					if (TRANSPARENT_WRAPPERS.has(typeName) && isBuiltIn(typeName, environment)) {
						return match(onlyTypeArgument(unwrapped))
							.with(P.nullish, () => null)
							.otherwise((inner) =>
								classifyAliasBroadTarget(inner, environment, substitutions, resolvingAliases),
							);
					}
					if (typeName === 'Record' && isBuiltIn(typeName, environment)) {
						return { kind: 'open dictionary' };
					}
					const alias = environment.aliases.get(typeName);
					if (alias === undefined || resolvingAliases.has(typeName)) return null;
					const nextSubstitutions = aliasSubstitution(alias, unwrapped, substitutions);
					if (nextSubstitutions === null) return null;
					const nextResolving = new Set(resolvingAliases);
					nextResolving.add(typeName);
					return classifyAliasBroadTarget(
						alias.typeAnnotation,
						environment,
						nextSubstitutions,
						nextResolving,
					);
				});
		});
}

export function unwrapEvidenceWrappers(expression: ESTree.Expression): ESTree.Expression {
	return match(expression)
		.with(
			{
				type: P.union(
					'ParenthesizedExpression',
					'TSAsExpression',
					'TSTypeAssertion',
					'TSNonNullExpression',
					'TSSatisfiesExpression',
				),
			},
			({ expression: inner }) => unwrapEvidenceWrappers(inner),
		)
		.otherwise((current) => current);
}

export function isKnownEvidenceExpression(expression: ESTree.Expression): boolean {
	return match(unwrapEvidenceWrappers(expression))
		.with(
			{
				type: P.union(
					'ObjectExpression',
					'ArrayExpression',
					'ArrowFunctionExpression',
					'ClassExpression',
					'FunctionExpression',
					'NewExpression',
					'Literal',
					'TemplateLiteral',
					'UnaryExpression',
				),
			},
			() => true,
		)
		.otherwise(() => false);
}
