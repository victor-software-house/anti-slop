import type { ESTree, SourceCode, Variable } from '@oxlint/plugins';
import { match, P } from 'ts-pattern';

function resolveVariable(
	sourceCode: SourceCode,
	identifier: ESTree.IdentifierReference,
): Variable | null {
	return match(
		sourceCode
			.getScope(identifier)
			.references.find((reference) => reference.identifier.start === identifier.start),
	)
		.returnType<Variable | null>()
		.with(P.nullish, () => null)
		.otherwise((reference) => reference.resolved);
}

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
