import type { ESTree } from '@oxlint/plugins';
import { defineRule } from '@oxlint/plugins';
import { match } from 'ts-pattern';

function unwrapParentheses(node: ESTree.Expression): ESTree.Expression {
	return match(node)
		.with({ type: 'ParenthesizedExpression' }, ({ expression }) => unwrapParentheses(expression))
		.otherwise((current) => current);
}

function isEmptyObjectExpression(node: ESTree.Expression): boolean {
	return match(node)
		.with({ type: 'ObjectExpression', properties: [] }, () => true)
		.otherwise(() => false);
}

function isConditionalEmptyObjectSpread(node: ESTree.Expression): boolean {
	return match(unwrapParentheses(node))
		.with(
			{ type: 'ConditionalExpression' },
			(conditional) =>
				isEmptyObjectExpression(conditional.consequent) ||
				isEmptyObjectExpression(conditional.alternate),
		)
		.otherwise(() => false);
}

/** Ban conditional empty-object spreads without changing their omission semantics. */
export const noConditionalEmptyObjectSpreadRule = defineRule({
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Disallow object spreads that conditionally spread an empty object to omit fields.',
		},
		messages: {
			avoid:
				'This conditional spread hides property omission behind an empty object. Build the object in separate statements and add the property only when present.',
		},
	},
	createOnce(context) {
		return {
			'ObjectExpression > SpreadElement'(node: ESTree.SpreadElement) {
				match(isConditionalEmptyObjectSpread(node.argument))
					.with(true, () => {
						context.report({ node, messageId: 'avoid' });
					})
					.otherwise(() => undefined);
			},
		};
	},
});
