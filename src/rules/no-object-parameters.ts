import { lexicalTypeParameterNames } from '@anti-slop/shared/lexical-type-parameters';
import type { ESTree, SourceCode } from '@oxlint/plugins';
import { defineRule } from '@oxlint/plugins';
import { match, P } from 'ts-pattern';

type Parameter = ESTree.ParamPattern;
type ParameterOwner =
	| ESTree.ArrowFunctionExpression
	| ESTree.Function
	| ESTree.TSCallSignatureDeclaration
	| ESTree.TSConstructSignatureDeclaration
	| ESTree.TSConstructorType
	| ESTree.TSFunctionType
	| ESTree.TSMethodSignature;

function parameterAnnotation(parameter: Parameter): ESTree.TSTypeAnnotation | null | undefined {
	return match(parameter)
		.with({ type: 'TSParameterProperty' }, ({ parameter: inner }) => parameterAnnotation(inner))
		.with(
			{ type: 'RestElement' },
			(rest) => rest.typeAnnotation ?? parameterAnnotation(rest.argument),
		)
		.with(
			{ type: 'AssignmentPattern' },
			(assignment) => assignment.typeAnnotation ?? assignment.left.typeAnnotation,
		)
		.otherwise((value) => value.typeAnnotation);
}

function parameterName(parameter: Parameter, sourceCode: SourceCode): string {
	return match(parameter)
		.with({ type: 'Identifier' }, ({ name }) => name)
		.otherwise(() => sourceCode.getText(parameter).replace(/\s*:\s*object\s*$/u, ''));
}

function exportedDeclaration(
	statement: ESTree.Program['body'][number],
): ESTree.Node | null | undefined {
	return match(statement)
		.with({ type: 'ExportNamedDeclaration' }, ({ declaration }) => declaration)
		.otherwise((value) => value);
}

/** Ban the broad object type on function inputs, including local aliases to object. */
export const noObjectParametersRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow object function parameters; inputs must use an owner-provided type and be parsed at their boundary.',
		},
		messages: {
			objectParameter:
				'Parameter `{{parameter}}` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.',
		},
	},
	createOnce(context) {
		const aliases = new Map<string, ESTree.TSType>();

		const resolvesToObject = (
			type: ESTree.TSType,
			shadowedAliases: ReadonlySet<string>,
			visited = new Set<string>(),
		): boolean =>
			match(type)
				.with({ type: 'TSObjectKeyword' }, () => true)
				.with({ type: 'TSParenthesizedType' }, ({ typeAnnotation }) =>
					resolvesToObject(typeAnnotation, shadowedAliases, visited),
				)
				.with({ type: 'TSUnionType' }, ({ types }) =>
					types.some((member) => resolvesToObject(member, shadowedAliases, visited)),
				)
				.with(
					{
						type: 'TSTypeReference',
						typeName: { type: 'Identifier', name: P.select() },
						typeArguments: P.union(P.nullish, { params: [] }),
					},
					(name) =>
						match({
							shadowed: visited.has(name) || shadowedAliases.has(name),
							alias: aliases.get(name),
						})
							.with({ shadowed: true }, () => false)
							.with({ alias: P.nullish }, () => false)
							.otherwise(({ alias }) =>
								match(alias)
									.with(P.nullish, () => false)
									.otherwise((present) => {
										const nextVisited = new Set(visited);
										nextVisited.add(name);
										return resolvesToObject(present, shadowedAliases, nextVisited);
									}),
							),
				)
				.otherwise(() => false);

		const checkParameters = (node: ParameterOwner) => {
			const shadowedAliases = lexicalTypeParameterNames(node);
			for (const parameter of node.params) {
				const annotation = parameterAnnotation(parameter);
				match(annotation)
					.with(P.nullish, () => undefined)
					.otherwise((present) =>
						match(resolvesToObject(present.typeAnnotation, shadowedAliases))
							.with(true, () => {
								context.report({
									node: present.typeAnnotation,
									messageId: 'objectParameter',
									data: { parameter: parameterName(parameter, context.sourceCode) },
								});
							})
							.otherwise(() => undefined),
					);
			}
		};

		return {
			Program(node) {
				aliases.clear();
				for (const statement of node.body) {
					match(exportedDeclaration(statement))
						.with({ type: 'TSTypeAliasDeclaration', typeParameters: P.nullish }, (alias) => {
							aliases.set(alias.id.name, alias.typeAnnotation);
						})
						.otherwise(() => undefined);
				}
			},
			'ArrowFunctionExpression, FunctionDeclaration, FunctionExpression, TSCallSignatureDeclaration, TSConstructSignatureDeclaration, TSConstructorType, TSDeclareFunction, TSEmptyBodyFunctionExpression, TSFunctionType, TSMethodSignature':
				checkParameters,
		};
	},
});
