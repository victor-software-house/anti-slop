import { isGlobalReflectMethodCall } from '@anti-slop/shared/reflect-method';
import type { ESTree } from '@oxlint/plugins';
import { defineRule } from '@oxlint/plugins';
import { match } from 'ts-pattern';

/** Ban Reflect.apply, which bypasses ordinary typed function calls. */
export const noReflectApplyRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow Reflect.apply; call typed functions directly or model dynamic dispatch behind an interface.',
		},
		messages: {
			reflectApply:
				'Replace `Reflect.apply` with a typed function call. Model dynamic dispatch behind a named interface.',
		},
	},
	createOnce(context) {
		return {
			'CallExpression[callee.type="MemberExpression"]'(node: ESTree.CallExpression) {
				match(isGlobalReflectMethodCall(context.sourceCode, node.callee, 'apply'))
					.with(true, () => {
						context.report({ node, messageId: 'reflectApply' });
					})
					.otherwise(() => undefined);
			},
		};
	},
});
