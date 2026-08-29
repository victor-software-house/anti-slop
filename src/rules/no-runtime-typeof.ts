import type { ESTree } from '@oxlint/plugins';
import { defineRule } from '@oxlint/plugins';
import { isMatching, match } from 'ts-pattern';

function isTypePredicateFunction(node: ESTree.Node): boolean {
	return isMatching({ returnType: { typeAnnotation: { type: 'TSTypePredicate' } } }, node);
}

/** Disallow runtime typeof checks that narrow unparsed values instead of decoding them. */
export const noRuntimeTypeofRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow runtime typeof checks; external values must be decoded into meaningful types at their I/O boundary.',
		},
		messages: {
			runtimeTypeof:
				'A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.',
		},
		schema: [
			{
				type: 'object',
				properties: {
					allowInTypeGuards: { type: 'boolean' },
				},
				additionalProperties: false,
			},
		],
		defaultOptions: [{ allowInTypeGuards: false }],
	},
	createOnce(context) {
		return {
			UnaryExpression(node) {
				match(node)
					.with({ operator: 'typeof' }, (typeofExpression) =>
						match({
							option: context.options[0],
							inGuard: isTypePredicateFunction(
								context.sourceCode.getScope(typeofExpression).variableScope.block,
							),
						})
							.with({ option: { allowInTypeGuards: true }, inGuard: true }, () => undefined)
							.otherwise(() => {
								context.report({ node: typeofExpression, messageId: 'runtimeTypeof' });
							}),
					)
					.otherwise(() => undefined);
			},
		};
	},
});
