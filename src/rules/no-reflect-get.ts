import { isGlobalReflectMethodCall } from '@anti-slop/shared/reflect-method';
import type { ESTree } from '@oxlint/plugins';
import { defineRule } from '@oxlint/plugins';
import { match } from 'ts-pattern';

/** Ban Reflect.get, which bypasses ordinary property access and useful type evidence. */
export const noReflectGetRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow Reflect.get; use typed property access or parse dynamic input into a domain type.',
		},
		messages: {
			reflectGet:
				'Replace `Reflect.get` with typed property access. Parse dynamic input into a named domain type before reading it.',
		},
	},
	createOnce(context) {
		return {
			'CallExpression[callee.type="MemberExpression"]'(node: ESTree.CallExpression) {
				match(isGlobalReflectMethodCall(context.sourceCode, node.callee, 'get'))
					.with(true, () => {
						context.report({ node, messageId: 'reflectGet' });
					})
					.otherwise(() => undefined);
			},
		};
	},
});
