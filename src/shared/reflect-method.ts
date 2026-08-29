import { resolveVariable } from '@anti-slop/shared/resolve-variable';
import type { ESTree, SourceCode } from '@oxlint/plugins';
import { match, P } from 'ts-pattern';

function isGlobalReflect(sourceCode: SourceCode, expression: ESTree.Expression): boolean {
	return match(expression)
		.with({ type: 'Identifier', name: 'Reflect' }, (identifier) =>
			match({
				global: sourceCode.isGlobalReference(identifier),
				variable: resolveVariable(sourceCode, identifier),
			})
				.with({ global: true }, () => true)
				.with({ variable: P.nullish }, () => true)
				.with({ variable: { defs: [] } }, () => true)
				.otherwise(() => false),
		)
		.otherwise(() => false);
}

/** Reports whether a call target names one method on the global Reflect object. */
export function isGlobalReflectMethodCall(
	sourceCode: SourceCode,
	callee: ESTree.Expression,
	methodName: string,
): boolean {
	return match(callee)
		.with(
			{
				type: 'MemberExpression',
				computed: false,
				property: { type: 'Identifier', name: P.select() },
			},
			(name, member) => isGlobalReflect(sourceCode, member.object) && name === methodName,
		)
		.with(
			{
				type: 'MemberExpression',
				computed: true,
				property: { type: 'Literal', value: P.select() },
			},
			(value, member) => isGlobalReflect(sourceCode, member.object) && value === methodName,
		)
		.otherwise(() => false);
}
