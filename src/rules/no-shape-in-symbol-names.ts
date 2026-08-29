import type { ESTree } from '@oxlint/plugins';
import { defineRule } from '@oxlint/plugins';
import { match } from 'ts-pattern';

const FORBIDDEN_SYMBOL_NAME = 'shape';

function containsForbiddenSymbolName(name: string): boolean {
	return name.toLowerCase().includes(FORBIDDEN_SYMBOL_NAME);
}

/** Ban the case-insensitive substring "shape" in every JavaScript and TypeScript symbol name. */
export const noForbiddenTermInSymbolNamesRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow the case-insensitive substring "shape" in JavaScript, TypeScript, private, and JSX symbol names.',
		},
		messages: {
			forbiddenSymbolName:
				'Rename symbol "{{name}}" for its domain role; "shape" describes structure rather than ownership.',
		},
	},
	createOnce(context) {
		const reportForbiddenSymbolName = (node: ESTree.Node & { name: string }) =>
			match(containsForbiddenSymbolName(node.name))
				.with(true, () => {
					context.report({
						node,
						messageId: 'forbiddenSymbolName',
						data: { name: node.name },
					});
				})
				.otherwise(() => undefined);

		return {
			'Identifier, PrivateIdentifier, JSXIdentifier': reportForbiddenSymbolName,
		};
	},
});
