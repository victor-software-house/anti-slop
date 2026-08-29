import { TypeEnvironment } from '@anti-slop/shared/dictionary-types';
import type { ESTree } from '@oxlint/plugins';
import { defineRule } from '@oxlint/plugins';
import { isMatching, match, P } from 'ts-pattern';

function referencedAliasName(node: ESTree.TSType): string | null {
	return match(node)
		.returnType<string | null>()
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

function isPlainAliasConsumerUse(node: ESTree.TSType, environment: TypeEnvironment): boolean {
	return match({
		onAliasRhs: isMatching({ type: 'TSTypeAliasDeclaration' }, node.parent),
		name: referencedAliasName(node),
	})
		.returnType<boolean>()
		.with({ onAliasRhs: false, name: P.string }, ({ name }) => environment.aliases.has(name))
		.otherwise(() => false);
}

/** Disallow object-dictionary contracts whose direct value type is an unsafe escape hatch. */
export const noUnsafeDictionaryTypeRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow object-dictionary contracts whose direct value type is unknown, any, object, {}, or a union/alias containing one of those escape hatches.',
		},
		messages: {
			unsafeDictionary:
				"This dictionary's {{value}} value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.",
		},
	},
	createOnce(context) {
		let environment = TypeEnvironment.empty();

		const report = (node: ESTree.Node, value: string) => {
			context.report({ node, messageId: 'unsafeDictionary', data: { value } });
		};

		const checkType = (
			node: ESTree.TSMappedType | ESTree.TSTypeLiteral | ESTree.TSTypeReference,
		) => {
			match({
				alias: isPlainAliasConsumerUse(node, environment),
				unsafe: environment.classifyUnsafeDictionary(node),
			})
				.with({ alias: true }, () => undefined)
				.with({ unsafe: P.nonNullable }, ({ unsafe }) => report(node, unsafe.unsafeValue))
				.otherwise(() => undefined);
		};

		return {
			Program(node) {
				environment = TypeEnvironment.fromProgram(node);
			},
			'TSTypeReference:not(TSTypeParameterInstantiation TSTypeReference)': checkType,
			'TSTypeLiteral:not(TSTypeParameterInstantiation TSTypeLiteral)': checkType,
			'TSMappedType:not(TSTypeParameterInstantiation TSMappedType)': checkType,
			'TSIndexSignature:not(TSTypeLiteral > TSIndexSignature)'(node: ESTree.TSIndexSignature) {
				match(node.typeAnnotation)
					.with(P.nullish, () => undefined)
					.otherwise((annotation) =>
						match(environment.classifyUnsafeDictionaryValue(annotation.typeAnnotation))
							.with(P.nonNullable, (unsafe) => report(node, unsafe.unsafeValue))
							.otherwise(() => undefined),
					);
			},
		};
	},
});
