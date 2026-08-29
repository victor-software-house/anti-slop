import type { ESTree, SourceCode, Variable } from '@oxlint/plugins';
import { defineRule } from '@oxlint/plugins';
import { match, P } from 'ts-pattern';

const moduleMockMethods = new Set(['doMock', 'mock', 'unstable_mockModule']);

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

function importedName(node: ESTree.Node): string | null {
	return match(node)
		.with(
			{ type: 'ImportSpecifier', imported: { type: 'Identifier', name: P.select() } },
			(name) => name,
		)
		.with(
			{ type: 'ImportSpecifier', imported: { type: 'Literal', value: P.select(P.string) } },
			(name) => name,
		)
		.otherwise(() => null);
}

function isTestFrameworkObject(
	sourceCode: SourceCode,
	expression: ESTree.Expression,
): expression is ESTree.IdentifierReference {
	return match(expression)
		.with({ type: 'Identifier' }, (identifier) =>
			match({
				name: identifier.name,
				global: sourceCode.isGlobalReference(identifier),
				variable: resolveVariable(sourceCode, identifier),
			})
				.with({ name: P.union('vi', 'jest'), global: true }, () => true)
				.with({ name: P.union('vi', 'jest'), variable: P.nullish }, () => true)
				.with({ name: P.union('vi', 'jest'), variable: { defs: [] } }, () => true)
				.otherwise(({ variable }) =>
					match(variable)
						.with(P.nullish, () => false)
						.otherwise((present) =>
							present.defs.some((definition) =>
								match(definition)
									.with(
										{ type: 'ImportBinding', parent: { type: 'ImportDeclaration' } },
										({ parent, node }) =>
											match({ source: parent.source.value, name: importedName(node) })
												.with({ source: 'vitest', name: 'vi' }, () => true)
												.with({ source: '@jest/globals', name: 'jest' }, () => true)
												.otherwise(() => false),
									)
									.otherwise(() => false),
							),
						),
				),
		)
		.otherwise(() => false);
}

function moduleMockCall(sourceCode: SourceCode, callee: ESTree.Expression): boolean {
	return match(callee)
		.with({ type: 'MemberExpression' }, (member) =>
			match(isTestFrameworkObject(sourceCode, member.object))
				.with(false, () => false)
				.with(true, () =>
					match(member)
						.with({ computed: false, property: { type: 'Identifier', name: P.select() } }, (name) =>
							moduleMockMethods.has(name),
						)
						.with({ computed: true, property: { type: 'Literal', value: P.select() } }, (value) =>
							match(value)
								.with(P.union('doMock', 'mock', 'unstable_mockModule'), () => true)
								.otherwise(() => false),
						)
						.otherwise(() => false),
				)
				.exhaustive(),
		)
		.otherwise(() => false);
}

/** Ban test framework module mocking in favor of real dependency seams. */
export const noModuleMockingRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow Vitest and Jest module mocking; tests must replace dependencies through real interfaces.',
		},
		messages: {
			moduleMock:
				'Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.',
		},
	},
	createOnce(context) {
		return {
			'CallExpression[callee.type="MemberExpression"]'(node: ESTree.CallExpression) {
				match(moduleMockCall(context.sourceCode, node.callee))
					.with(true, () => {
						context.report({ node, messageId: 'moduleMock' });
					})
					.otherwise(() => undefined);
			},
		};
	},
});
