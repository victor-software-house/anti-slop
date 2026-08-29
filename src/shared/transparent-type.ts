import type { ESTree } from '@oxlint/plugins';
import { match, P } from 'ts-pattern';

export const BUILT_INS = new Set([
	'Record',
	'Readonly',
	'Partial',
	'Required',
	'Pick',
	'Omit',
	'PropertyKey',
	'NonNullable',
]);

export const TRANSPARENT_WRAPPERS = new Set(['Readonly', 'Partial', 'Required', 'NonNullable']);

export function typeReferenceName(type: ESTree.TSTypeReference): string | null {
	return match(type.typeName)
		.with({ type: 'Identifier' }, ({ name }) => name)
		.otherwise(() => null);
}

export function unwrapTransparentType(type: ESTree.TSType): ESTree.TSType {
	return match(type)
		.with({ type: 'TSParenthesizedType' }, ({ typeAnnotation }) =>
			unwrapTransparentType(typeAnnotation),
		)
		.with({ type: 'TSTypeOperator', operator: 'readonly' }, ({ typeAnnotation }) =>
			unwrapTransparentType(typeAnnotation),
		)
		.otherwise((current) => current);
}

export function isUnappliedReferenceTo(type: ESTree.TSType, name: string): boolean {
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

export function typeArgumentList(reference: ESTree.TSTypeReference): readonly ESTree.TSType[] {
	return reference.typeArguments?.params ?? [];
}

export function onlyTypeArgument(reference: ESTree.TSTypeReference): ESTree.TSType | null {
	return match(typeArgumentList(reference))
		.with([P.select()], (type) => type)
		.otherwise(() => null);
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

export function isEffectivelyEmptyTypeLiteral(type: ESTree.TSTypeLiteral): boolean {
	return type.members.length === 0 || type.members.every(isEffectivelyEmptyMember);
}

export function isEffectivelyEmptyInterface(
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
