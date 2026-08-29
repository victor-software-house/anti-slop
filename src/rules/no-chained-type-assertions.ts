import type { ESTree } from '@oxlint/plugins';
import { defineRule } from '@oxlint/plugins';
import { isMatching, match, P } from 'ts-pattern';

type TypeAssertionExpression = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

function isTypeAssertionExpression(node: ESTree.Node): node is TypeAssertionExpression {
	return isMatching({ type: P.union('TSAsExpression', 'TSTypeAssertion') }, node);
}

function unwrapParenthesizedExpression(expression: ESTree.Expression): ESTree.Expression {
	return match(expression)
		.returnType<ESTree.Expression>()
		.with({ type: 'ParenthesizedExpression' }, ({ expression: inner }) =>
			unwrapParenthesizedExpression(inner),
		)
		.otherwise((current) => current);
}

function isConstAssertion(node: TypeAssertionExpression): boolean {
	return match(node.typeAnnotation)
		.returnType<boolean>()
		.with({ type: 'TSTypeReference', typeName: { type: 'Identifier', name: 'const' } }, () => true)
		.otherwise(() => false);
}

function assertionChain(expression: ESTree.Expression): { count: number; hasNonConst: boolean } {
	return match(expression)
		.returnType<{ count: number; hasNonConst: boolean }>()
		.with({ type: P.union('TSAsExpression', 'TSTypeAssertion') }, (assertion) => {
			const rest = assertionChain(unwrapParenthesizedExpression(assertion.expression));
			return {
				count: rest.count + 1,
				hasNonConst: rest.hasNonConst || !isConstAssertion(assertion),
			};
		})
		.otherwise(() => ({ count: 0, hasNonConst: false }));
}

function isForbiddenAssertionChain(node: TypeAssertionExpression): boolean {
	return match(assertionChain(node))
		.returnType<boolean>()
		.with({ hasNonConst: false }, () => false)
		.with({ count: 1 }, () => false)
		.otherwise(() => true);
}

/** Disallow nested TypeScript type assertions, while permitting chains made only of const assertions. */
export const noChainedTypeAssertionsRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow chained TypeScript as and angle-bracket assertions, including parenthesized chains.',
		},
		messages: {
			chained:
				'This assertion chain discards type evidence. Keep the original precise type, or parse untrusted input at its boundary before narrowing it.',
		},
	},
	createOnce(context) {
		const checkAssertion = (node: ESTree.Node) => {
			if (!isTypeAssertionExpression(node)) {
				return;
			}
			match(isForbiddenAssertionChain(node))
				.with(true, () => {
					context.report({ node, messageId: 'chained' });
				})
				.otherwise(() => undefined);
		};

		return {
			'TSAsExpression:not(TSAsExpression TSAsExpression, TSTypeAssertion TSAsExpression)':
				checkAssertion,
			'TSTypeAssertion:not(TSAsExpression TSTypeAssertion, TSTypeAssertion TSTypeAssertion)':
				checkAssertion,
		};
	},
});
