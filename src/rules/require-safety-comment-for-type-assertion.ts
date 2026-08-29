import type { ESTree, SourceCode } from '@oxlint/plugins';
import { defineRule } from '@oxlint/plugins';
import { isMatching, match, P } from 'ts-pattern';

type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

function isConstAssertion(node: TypeAssertion): boolean {
	return match(node.typeAnnotation)
		.returnType<boolean>()
		.with({ type: 'TSTypeReference', typeName: { type: 'Identifier', name: 'const' } }, () => true)
		.otherwise(() => false);
}

function commentHasSafety(
	sourceCode: SourceCode,
	node: ESTree.Node,
	assertionStart: number,
): boolean {
	return sourceCode
		.getCommentsBefore(node)
		.some((comment) => comment.end <= assertionStart && /\bSAFETY\s*:/u.test(comment.value));
}

function hasSafetyComment(sourceCode: SourceCode, node: TypeAssertion): boolean {
	if (commentHasSafety(sourceCode, node, node.start)) {
		return true;
	}
	const parent = node.parent;
	if (isMatching({ type: 'VariableDeclarator', parent: { type: 'VariableDeclaration' } }, parent)) {
		return commentHasSafety(sourceCode, parent.parent, node.start);
	}
	if (
		isMatching(
			{
				type: P.union(
					'ExpressionStatement',
					'PropertyDefinition',
					'ReturnStatement',
					'ThrowStatement',
				),
			},
			parent,
		)
	) {
		return commentHasSafety(sourceCode, parent, node.start);
	}
	return false;
}

/** Require every non-const type assertion to state the invariant TypeScript cannot express. */
export const requireSafetyCommentForTypeAssertionRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description:
				'Require a nearby SAFETY comment for every TypeScript type assertion except const assertions.',
		},
		messages: {
			missingSafetyComment:
				'This type assertion has no `SAFETY:` justification. State the checked invariant immediately before the assertion or its containing statement.',
		},
	},
	createOnce(context) {
		const checkAssertion = (node: TypeAssertion) =>
			match({
				constAssertion: isConstAssertion(node),
				commented: hasSafetyComment(context.sourceCode, node),
			})
				.with({ constAssertion: true }, () => undefined)
				.with({ commented: true }, () => undefined)
				.otherwise(() => {
					context.report({ node, messageId: 'missingSafetyComment' });
				});

		return {
			TSAsExpression: checkAssertion,
			TSTypeAssertion: checkAssertion,
		};
	},
});
