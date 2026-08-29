import type { ESTree } from '@oxlint/plugins';
import { defineRule } from '@oxlint/plugins';
import { match, P } from 'ts-pattern';

function referencedAliasName(type: ESTree.TSType): string | null {
	return match(type)
		.with({ type: 'TSParenthesizedType' }, ({ typeAnnotation }) =>
			referencedAliasName(typeAnnotation),
		)
		.with(
			{
				type: 'TSTypeReference',
				typeName: { type: 'Identifier', name: P.select() },
				typeArguments: P.union(P.nullish, { params: [] }),
			},
			(name) => name,
		)
		.otherwise(() => null);
}

function exportedDeclaration(
	statement: ESTree.Program['body'][number],
): ESTree.Node | null | undefined {
	return match(statement)
		.with({ type: 'ExportNamedDeclaration' }, ({ declaration }) => declaration)
		.otherwise((value) => value);
}

/** Ban named aliases that merely conceal TypeScript's unknown top type. */
export const noUnknownTypeAliasesRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow type aliases whose resolved type is unknown; unknown must remain visible at an allowed boundary.',
		},
		messages: {
			unknownAlias:
				'Type alias `{{alias}}` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.',
		},
	},
	createOnce(context) {
		const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();

		const resolvesToUnknown = (type: ESTree.TSType, visited = new Set<string>()): boolean =>
			match(type)
				.with({ type: 'TSUnknownKeyword' }, () => true)
				.with({ type: 'TSParenthesizedType' }, ({ typeAnnotation }) =>
					resolvesToUnknown(typeAnnotation, visited),
				)
				.otherwise((current) =>
					match(referencedAliasName(current))
						.with(P.nullish, () => false)
						.when(
							(name) => visited.has(name),
							() => false,
						)
						.otherwise((name) =>
							match(aliases.get(name))
								.with(P.nullish, () => false)
								.when(
									(alias) => alias.typeParameters != null,
									() => false,
								)
								.otherwise((alias) => {
									const nextVisited = new Set(visited);
									nextVisited.add(name);
									return resolvesToUnknown(alias.typeAnnotation, nextVisited);
								}),
						),
				);

		return {
			Program(node) {
				aliases.clear();
				for (const statement of node.body) {
					match(exportedDeclaration(statement))
						.with({ type: 'TSTypeAliasDeclaration' }, (alias) => {
							aliases.set(alias.id.name, alias);
						})
						.otherwise(() => undefined);
				}
				for (const alias of aliases.values()) {
					match(resolvesToUnknown(alias.typeAnnotation, new Set([alias.id.name])))
						.with(true, () => {
							context.report({
								node: alias.id,
								messageId: 'unknownAlias',
								data: { alias: alias.id.name },
							});
						})
						.otherwise(() => undefined);
				}
			},
		};
	},
});
