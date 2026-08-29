import { lexicalTypeParameterNames } from '@anti-slop/shared/lexical-type-parameters';
import type { ESTree } from '@oxlint/plugins';
import { defineRule } from '@oxlint/plugins';
import { match, P } from 'ts-pattern';

type FunctionWithReturnType =
	| ESTree.ArrowFunctionExpression
	| ESTree.Function
	| ESTree.TSCallSignatureDeclaration
	| ESTree.TSConstructSignatureDeclaration
	| ESTree.TSConstructorType
	| ESTree.TSFunctionType
	| ESTree.TSMethodSignature;

function referencedAliasName(type: ESTree.TSType): string | null {
	return match(type)
		.with({ type: 'TSParenthesizedType' }, ({ typeAnnotation }) =>
			referencedAliasName(typeAnnotation),
		)
		.with(
			{
				type: 'TSTypeReference',
				typeName: { type: 'Identifier', name: P.select() },
				typeArguments: P.union(P.nullish, { params: [] }),
			},
			(name) => name,
		)
		.otherwise(() => null);
}

function exportedDeclaration(
	statement: ESTree.Program['body'][number],
): ESTree.Node | null | undefined {
	return match(statement)
		.with({ type: 'ExportNamedDeclaration' }, ({ declaration }) => declaration)
		.otherwise((value) => value);
}

/** Ban function contracts that return unknown instead of a parsed domain type. */
export const noUnknownReturnsRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow functions whose explicit return contract is unknown or Promise<unknown>.',
		},
		messages: {
			unknownReturn:
				'This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.',
		},
	},
	createOnce(context) {
		const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();

		const resolvesToUnknown = (
			type: ESTree.TSType,
			shadowedAliases: ReadonlySet<string>,
			visited = new Set<string>(),
		): boolean =>
			match(type)
				.with({ type: 'TSUnknownKeyword' }, () => true)
				.with({ type: 'TSParenthesizedType' }, ({ typeAnnotation }) =>
					resolvesToUnknown(typeAnnotation, shadowedAliases, visited),
				)
				.with({ type: 'TSUnionType' }, ({ types }) =>
					types.some((member) => resolvesToUnknown(member, shadowedAliases, visited)),
				)
				.with(
					{
						type: 'TSTypeReference',
						typeName: { type: 'Identifier', name: P.union('Promise', 'PromiseLike') },
						typeArguments: { params: [P.select()] },
					},
					(value) => resolvesToUnknown(value, shadowedAliases, visited),
				)
				.otherwise((current) =>
					match(referencedAliasName(current))
						.with(P.nullish, () => false)
						.when(
							(name) => visited.has(name) || shadowedAliases.has(name),
							() => false,
						)
						.otherwise((name) =>
							match(aliases.get(name))
								.with(P.nullish, () => false)
								.with({ typeParameters: P.nonNullable }, () => false)
								.otherwise((alias) => {
									const nextVisited = new Set(visited);
									nextVisited.add(name);
									return resolvesToUnknown(alias.typeAnnotation, shadowedAliases, nextVisited);
								}),
						),
				);

		const checkReturnType = (node: FunctionWithReturnType) => {
			match(node.returnType)
				.with(P.nullish, () => undefined)
				.otherwise((annotation) =>
					match(resolvesToUnknown(annotation.typeAnnotation, lexicalTypeParameterNames(node)))
						.with(true, () => {
							context.report({ node: annotation.typeAnnotation, messageId: 'unknownReturn' });
						})
						.otherwise(() => undefined),
				);
		};

		return {
			Program(node) {
				aliases.clear();
				for (const statement of node.body) {
					match(exportedDeclaration(statement))
						.with({ type: 'TSTypeAliasDeclaration' }, (alias) => {
							aliases.set(alias.id.name, alias);
						})
						.otherwise(() => undefined);
				}
			},
			'ArrowFunctionExpression, FunctionDeclaration, FunctionExpression, TSCallSignatureDeclaration, TSConstructSignatureDeclaration, TSConstructorType, TSDeclareFunction, TSEmptyBodyFunctionExpression, TSFunctionType, TSMethodSignature':
				checkReturnType,
		};
	},
});
