import type { Context, ESTree } from '@oxlint/plugins';
import { defineRule } from '@oxlint/plugins';
import { match, P } from 'ts-pattern';

const SERVICE_CONSTRUCTOR_NAME = /^make[A-Z]/u;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

function getImportedName(specifier: ESTree.ImportSpecifier): string {
	return match(specifier.imported)
		.with({ type: 'Identifier', name: P.select() }, (name) => name)
		.otherwise((imported) => imported.value);
}

function reportLocalServiceConstructor(context: Context, specifier: ESTree.ImportSpecifier): void {
	match(getImportedName(specifier))
		.when(
			(name) => SERVICE_CONSTRUCTOR_NAME.test(name),
			(name) => {
				context.report({
					node: specifier,
					messageId: 'serviceConstructorImport',
					data: { name },
				});
			},
		)
		.otherwise(() => undefined);
}

/** Keep dependency-bearing Effect service constructors local to their owning capability modules. */
export const noServiceConstructorImportsRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow project-local make<CapabilityName> imports outside test and spec files.',
		},
		messages: {
			serviceConstructorImport:
				'Do not import Effect service constructor "{{name}}" into runtime code. Import the owning Layer, yield the contextual service, and allow its requirements to propagate to the composition root.',
		},
	},
	createOnce(context) {
		return {
			before() {
				return match(context.filename.replaceAll('\\', '/'))
					.returnType<false | undefined>()
					.when(
						(path) => TEST_FILE.test(path),
						() => false,
					)
					.otherwise(() => undefined);
			},
			'ImportDeclaration[source.value=/^\\./]'(node: ESTree.ImportDeclaration) {
				for (const specifier of node.specifiers) {
					match(specifier)
						.with({ type: 'ImportSpecifier' }, (spec) => {
							reportLocalServiceConstructor(context, spec);
						})
						.otherwise(() => undefined);
				}
			},
		};
	},
});
