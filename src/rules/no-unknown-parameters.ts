import type { ESTree } from '@oxlint/plugins';
import { defineRule } from '@oxlint/plugins';
import { match } from 'ts-pattern';

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

function parameterName(parameter: Parameter, sourceText: string): string {
	return match(parameter)
		.with({ type: 'TSParameterProperty' }, ({ parameter: inner }) =>
			parameterName(inner, sourceText),
		)
		.with({ type: 'AssignmentPattern' }, ({ left }) => parameterName(left, sourceText))
		.with({ type: 'RestElement' }, ({ argument }) => parameterName(argument, sourceText))
		.with({ type: 'Identifier' }, ({ name }) => name)
		.otherwise(() => sourceText.replace(/\s*:\s*unknown\s*$/u, ''));
}

/** Disallow unknown inputs except explicitly named error-cause enrichment. */
export const noUnknownParametersRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow explicitly unknown function parameters except `cause`; decode unknown input at its I/O boundary instead.',
		},
		messages: {
			unknownParameter:
				'Parameter `{{parameter}}` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.',
		},
	},
	createOnce(context) {
		const checkParameters = (node: ParameterOwner) => {
			for (const parameter of node.params) {
				const annotation = parameterAnnotation(parameter);
				match(annotation?.typeAnnotation)
					.with({ type: 'TSUnknownKeyword' }, (unknownType) => {
						const name = parameterName(parameter, context.sourceCode.getText(parameter));
						match(name)
							.with('cause', () => undefined)
							.otherwise((parameterNameText) => {
								context.report({
									node: unknownType,
									messageId: 'unknownParameter',
									data: { parameter: parameterNameText },
								});
							});
					})
					.otherwise(() => undefined);
			}
		};

		return {
			'ArrowFunctionExpression, FunctionDeclaration, FunctionExpression, TSCallSignatureDeclaration, TSConstructSignatureDeclaration, TSConstructorType, TSDeclareFunction, TSEmptyBodyFunctionExpression, TSFunctionType, TSMethodSignature':
				checkParameters,
		};
	},
});
