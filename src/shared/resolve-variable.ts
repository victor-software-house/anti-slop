import type { ESTree, SourceCode, Variable } from '@oxlint/plugins';
import { match, P } from 'ts-pattern';

/** Binding for this identifier in its scope, or missing when the reference is unresolved. */
export function resolveVariable(
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
