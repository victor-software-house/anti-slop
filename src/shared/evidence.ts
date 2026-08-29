import type { ESTree } from '@oxlint/plugins';
import { match, P } from 'ts-pattern';

export function unwrapEvidenceWrappers(expression: ESTree.Expression): ESTree.Expression {
	return match(expression)
		.with(
			{
				type: P.union(
					'ParenthesizedExpression',
					'TSAsExpression',
					'TSTypeAssertion',
					'TSNonNullExpression',
					'TSSatisfiesExpression',
				),
			},
			({ expression: inner }) => unwrapEvidenceWrappers(inner),
		)
		.otherwise((current) => current);
}

export function isKnownEvidenceExpression(expression: ESTree.Expression): boolean {
	return match(unwrapEvidenceWrappers(expression))
		.with(
			{
				type: P.union(
					'ObjectExpression',
					'ArrayExpression',
					'ArrowFunctionExpression',
					'ClassExpression',
					'FunctionExpression',
					'NewExpression',
					'Literal',
					'TemplateLiteral',
					'UnaryExpression',
				),
			},
			() => true,
		)
		.otherwise(() => false);
}
