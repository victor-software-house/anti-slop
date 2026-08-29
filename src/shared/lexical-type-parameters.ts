import type { ESTree } from '@oxlint/plugins';
import { isMatching, match, P } from 'ts-pattern';

function addTypeParameterNames(
	params: ReadonlyArray<{ readonly name: { readonly name: string } }>,
	names: Set<string>,
): void {
	for (const parameter of params) {
		names.add(parameter.name.name);
	}
}

function collectInferTypeParameterNames(type: ESTree.TSType, names: Set<string>): void {
	match(type)
		.with({ type: 'TSInferType', typeParameter: { name: { name: P.select() } } }, (name) => {
			names.add(name);
		})
		.with({ type: 'TSTypeReference', typeArguments: { params: P.select() } }, (params) => {
			for (const param of params) {
				collectInferTypeParameterNames(param, names);
			}
		})
		.with({ type: P.union('TSUnionType', 'TSIntersectionType'), types: P.select() }, (types) => {
			for (const member of types) {
				collectInferTypeParameterNames(member, names);
			}
		})
		.with({ type: 'TSParenthesizedType', typeAnnotation: P.select() }, (inner) => {
			collectInferTypeParameterNames(inner, names);
		})
		.otherwise(() => undefined);
}

function addOwnTypeParameters(node: ESTree.Node, names: Set<string>): void {
	if (isMatching({ typeParameters: { params: P.array({ name: { name: P.string } }) } }, node)) {
		addTypeParameterNames(node.typeParameters.params, names);
	}
}

function addFromParent(node: ESTree.Node, names: Set<string>): void {
	const parent = node.parent;
	if (isMatching({ type: 'TSMappedType', key: { name: P.string } }, parent)) {
		names.add(parent.key.name);
	}
	if (
		isMatching(
			{ type: 'TSConditionalType', trueType: P.nonNullable, extendsType: P.nonNullable },
			parent,
		) &&
		parent.trueType === node
	) {
		collectInferTypeParameterNames(parent.extendsType, names);
	}
	if (
		isMatching(
			{
				type: 'TSTypeAliasDeclaration',
				typeParameters: { params: P.array({ name: { name: P.string } }) },
			},
			parent,
		)
	) {
		addTypeParameterNames(parent.typeParameters.params, names);
	}
	if (
		isMatching(
			{
				type: 'TSInterfaceBody',
				parent: {
					type: 'TSInterfaceDeclaration',
					typeParameters: { params: P.array({ name: { name: P.string } }) },
				},
			},
			parent,
		)
	) {
		addTypeParameterNames(parent.parent.typeParameters.params, names);
	}
}

/** Collect type binders that are in scope at a node and can shadow module aliases. */
export function lexicalTypeParameterNames(node: ESTree.Node): ReadonlySet<string> {
	const names = new Set<string>();
	addOwnTypeParameters(node, names);
	addFromParent(node, names);
	return names;
}
