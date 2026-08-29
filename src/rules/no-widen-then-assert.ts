import type { ESTree, Scope, SourceCode, Variable } from '@oxlint/plugins';
import { defineRule } from '@oxlint/plugins';
import { isMatching, match, P } from 'ts-pattern';

type BroadTypeKind = 'top' | 'object' | 'record';

type KnownValueEvidence = {
	readonly type: ESTree.TSType | null;
};

function unwrapExpressionParentheses(expression: ESTree.Expression): ESTree.Expression {
	return match(expression)
		.with({ type: 'ParenthesizedExpression' }, ({ expression: inner }) =>
			unwrapExpressionParentheses(inner),
		)
		.otherwise((current) => current);
}

function unwrapTypeParentheses(type: ESTree.TSType): ESTree.TSType {
	return match(type)
		.with({ type: 'TSParenthesizedType' }, ({ typeAnnotation }) =>
			unwrapTypeParentheses(typeAnnotation),
		)
		.otherwise((current) => current);
}

function typeReferenceName(type: ESTree.TSTypeReference): string | null {
	return match(type.typeName)
		.with({ type: 'Identifier' }, ({ name }) => name)
		.otherwise(() => null);
}

function isUnknownOrAnyType(type: ESTree.TSType): boolean {
	return match(unwrapTypeParentheses(type))
		.with({ type: P.union('TSUnknownKeyword', 'TSAnyKeyword') }, () => true)
		.otherwise(() => false);
}

function isBroadRecordKeyType(type: ESTree.TSType): boolean {
	return match(unwrapTypeParentheses(type))
		.with({ type: P.union('TSStringKeyword', 'TSNumberKeyword', 'TSSymbolKeyword') }, () => true)
		.with({ type: 'TSUnionType' }, ({ types }) => types.every(isBroadRecordKeyType))
		.with(
			{ type: 'TSTypeReference', typeName: { type: 'Identifier', name: 'PropertyKey' } },
			() => true,
		)
		.otherwise(() => false);
}

function isBroadRecordType(type: ESTree.TSType): boolean {
	return match(unwrapTypeParentheses(type))
		.with({ type: 'TSTypeReference' }, (reference) => isBroadRecordTypeReference(reference))
		.with({ type: 'TSTypeLiteral' }, (literal) => isBroadIndexSignatureType(literal))
		.otherwise(() => false);
}

function isBroadRecordTypeReference(unwrapped: ESTree.TSTypeReference): boolean {
	return match({
		name: typeReferenceName(unwrapped),
		params: unwrapped.typeArguments?.params ?? [],
	})
		.with({ name: 'Readonly', params: [P.select()] }, (inner) => isBroadRecordType(inner))
		.with(
			{ name: 'Record', params: [P.select('key'), P.select('value')] },
			({ key, value }) => isBroadRecordKeyType(key) && isUnknownOrAnyType(value),
		)
		.otherwise(() => false);
}

function isBroadIndexSignatureType(type: ESTree.TSTypeLiteral): boolean {
	return match(type.members)
		.with(
			[
				{
					type: 'TSIndexSignature',
					parameters: [P.select('parameter')],
					typeAnnotation: P.select('annotation'),
				},
			],
			({ parameter, annotation }) =>
				isBroadRecordKeyType(parameter.typeAnnotation.typeAnnotation) &&
				isUnknownOrAnyType(annotation.typeAnnotation),
		)
		.otherwise(() => false);
}

function broadTypeKind(type: ESTree.TSType): BroadTypeKind | null {
	return match(unwrapTypeParentheses(type))
		.returnType<BroadTypeKind | null>()
		.with({ type: P.union('TSUnknownKeyword', 'TSAnyKeyword') }, () => 'top')
		.with({ type: 'TSObjectKeyword' }, () => 'object')
		.when(isBroadRecordType, () => 'record')
		.otherwise(() => null);
}

function assertedExpression(
	node: ESTree.TSAsExpression | ESTree.TSTypeAssertion,
): ESTree.Expression {
	return unwrapExpressionParentheses(node.expression);
}

function assertionFromExpression(
	expression: ESTree.Expression,
): ESTree.TSAsExpression | ESTree.TSTypeAssertion | null {
	return match(unwrapExpressionParentheses(expression))
		.with({ type: P.union('TSAsExpression', 'TSTypeAssertion') }, (assertion) => assertion)
		.otherwise(() => null);
}

function normalizedTypeText(sourceText: string, type: ESTree.TSType): string {
	return sourceText.slice(type.start, type.end).replaceAll(/\s+/gu, '');
}

function typesHaveSameSyntax(
	sourceText: string,
	left: ESTree.TSType | null,
	right: ESTree.TSType,
): boolean {
	return match(left)
		.returnType<boolean>()
		.with(P.nullish, () => false)
		.otherwise(
			(present) =>
				normalizedTypeText(sourceText, unwrapTypeParentheses(present)) ===
				normalizedTypeText(sourceText, unwrapTypeParentheses(right)),
		);
}

function isDefinitelyObjectType(type: ESTree.TSType): boolean {
	return match(unwrapTypeParentheses(type))
		.with(
			{
				type: P.union(
					'TSArrayType',
					'TSConstructorType',
					'TSFunctionType',
					'TSMappedType',
					'TSObjectKeyword',
					'TSTupleType',
				),
			},
			() => true,
		)
		.with({ type: 'TSTypeLiteral' }, ({ members }) => members.length > 0)
		.with({ type: 'TSIntersectionType' }, ({ types }) => types.every(isDefinitelyObjectType))
		.with({ type: 'TSTypeOperator', operator: 'readonly' }, ({ typeAnnotation }) =>
			isDefinitelyObjectType(typeAnnotation),
		)
		.otherwise(() => false);
}

function isDefinitelyNarrowerRecordType(type: ESTree.TSType): boolean {
	return match(unwrapTypeParentheses(type))
		.with({ type: 'TSTypeLiteral' }, ({ members }) =>
			members.some((member) => member.type !== 'TSIndexSignature'),
		)
		.with(
			{
				type: 'TSTypeReference',
				typeName: { type: 'Identifier', name: 'Readonly' },
				typeArguments: { params: [P.select()] },
			},
			(inner) => isDefinitelyNarrowerRecordType(inner),
		)
		.with(
			{
				type: 'TSTypeReference',
				typeName: { type: 'Identifier', name: 'Record' },
				typeArguments: { params: [P._, P.select()] },
			},
			(value) => !isUnknownOrAnyType(value),
		)
		.otherwise(() => false);
}

function functionScope(sourceCode: SourceCode, node: ESTree.Node): Scope {
	return sourceCode.getScope(node).variableScope;
}

const isConstVariableDeclaration = isMatching({ type: 'VariableDeclaration', kind: 'const' });

function resolvedVariableForIdentifier(
	scopes: readonly Scope[],
	identifier: ESTree.IdentifierReference,
): Variable | null {
	for (const scope of scopes) {
		const reference = scope.references.find(
			(candidate) =>
				candidate.identifier.start === identifier.start &&
				candidate.identifier.end === identifier.end,
		);
		if (reference !== undefined) return reference.resolved;
	}
	return null;
}

function variableDeclarator(variable: Variable): ESTree.VariableDeclarator | null {
	return match(variable.defs.find((definition) => definition.type === 'Variable'))
		.with({ node: { type: 'VariableDeclarator' } }, ({ node }) => node)
		.otherwise(() => null);
}

function knownValueEvidence(
	sourceCode: SourceCode,
	expression: ESTree.Expression,
	scopes: readonly Scope[],
	boundary: Scope,
	visitedVariables: ReadonlySet<Variable>,
): KnownValueEvidence | null {
	return match(unwrapExpressionParentheses(expression))
		.returnType<KnownValueEvidence | null>()
		.with({ type: P.union('TSAsExpression', 'TSTypeAssertion') }, (assertion) =>
			match(broadTypeKind(assertion.typeAnnotation))
				.with(P.nullish, () => ({ type: assertion.typeAnnotation }))
				.otherwise(() => null),
		)
		.with(
			{
				type: P.union(
					'Literal',
					'TemplateLiteral',
					'ArrayExpression',
					'ArrowFunctionExpression',
					'ClassExpression',
					'FunctionExpression',
					'NewExpression',
					'ObjectExpression',
				),
			},
			() => ({ type: null }),
		)
		.with({ type: 'Identifier' }, (identifier) =>
			knownValueFromIdentifier(sourceCode, identifier, scopes, boundary, visitedVariables),
		)
		.otherwise(() => null);
}

function knownValueFromIdentifier(
	sourceCode: SourceCode,
	identifier: ESTree.IdentifierReference,
	scopes: readonly Scope[],
	boundary: Scope,
	visitedVariables: ReadonlySet<Variable>,
): KnownValueEvidence | null {
	return match(resolvedVariableForIdentifier(scopes, identifier))
		.returnType<KnownValueEvidence | null>()
		.with(P.nullish, () => null)
		.when(
			(variable) => visitedVariables.has(variable),
			() => null,
		)
		.otherwise((variable) =>
			match(
				variable.identifiers.find((candidate) =>
					match(candidate.typeAnnotation)
						.with(P.nullish, () => false)
						.otherwise(() => true),
				),
			)
				.returnType<KnownValueEvidence | null>()
				.with({ typeAnnotation: { typeAnnotation: P.select() } }, (annotation, annotated) =>
					match({
						sameScope: functionScope(sourceCode, annotated) === boundary,
						broad: broadTypeKind(annotation),
					})
						.returnType<KnownValueEvidence | null>()
						.with({ sameScope: true, broad: P.nullish }, () => ({ type: annotation }))
						.otherwise(() => null),
				)
				.otherwise(() =>
					match(variableDeclarator(variable))
						.returnType<KnownValueEvidence | null>()
						.with(
							{
								init: P.nonNullable,
								parent: { type: 'VariableDeclaration', kind: 'const' },
							},
							(declarator) =>
								match({
									mutated: variable.references.some(
										(reference) => reference.isWrite() && !reference.init,
									),
									sameScope: functionScope(sourceCode, declarator) === boundary,
								})
									.returnType<KnownValueEvidence | null>()
									.with({ mutated: false, sameScope: true }, () =>
										knownValueEvidence(
											sourceCode,
											declarator.init,
											scopes,
											boundary,
											new Set([...visitedVariables, variable]),
										),
									)
									.otherwise(() => null),
						)
						.otherwise(() => null),
				),
		);
}

function widenedBinding(
	sourceCode: SourceCode,
	variable: Variable,
	scopes: readonly Scope[],
): {
	readonly broadKind: BroadTypeKind;
	readonly evidence: KnownValueEvidence;
	readonly declaredAt: number;
	readonly boundary: Scope;
} | null {
	return match(variableDeclarator(variable))
		.returnType<{
			readonly broadKind: BroadTypeKind;
			readonly evidence: KnownValueEvidence;
			readonly declaredAt: number;
			readonly boundary: Scope;
		} | null>()
		.with(
			{
				init: P.nonNullable,
				id: { type: 'Identifier' },
			},
			(declarator) =>
				match({
					constDecl: isConstVariableDeclaration(declarator.parent),
					mutated: variable.references.some((reference) => reference.isWrite() && !reference.init),
				})
					.returnType<{
						readonly broadKind: BroadTypeKind;
						readonly evidence: KnownValueEvidence;
						readonly declaredAt: number;
						readonly boundary: Scope;
					} | null>()
					.with({ constDecl: false }, () => null)
					.with({ mutated: true }, () => null)
					.otherwise(() => {
						const init = declarator.init;
						const boundary = functionScope(sourceCode, declarator);
						const declaredType = declarator.id.typeAnnotation?.typeAnnotation;
						const initializerAssertion = assertionFromExpression(init);
						const initializerBroadKind = match(initializerAssertion)
							.with(P.nullish, () => null)
							.otherwise((assertion) => broadTypeKind(assertion.typeAnnotation));
						const declaredBroadKind = match(declaredType)
							.with(P.nullish, () => null)
							.otherwise((type) => broadTypeKind(type));
						const broadKind = declaredBroadKind ?? initializerBroadKind;

						return match(broadKind)
							.with(P.nullish, () => null)
							.otherwise((kind) =>
								match(
									knownValueEvidence(
										sourceCode,
										match({ initializerAssertion, initializerBroadKind })
											.with(
												{
													initializerAssertion: P.nonNullable,
													initializerBroadKind: P.nonNullable,
												},
												({ initializerAssertion: assertion }) => assertedExpression(assertion),
											)
											.otherwise(() => init),
										scopes,
										boundary,
										new Set([variable]),
									),
								)
									.with(P.nullish, () => null)
									.otherwise((evidence) => ({
										broadKind: kind,
										evidence,
										declaredAt: declarator.end,
										boundary,
									})),
							);
					}),
		)
		.otherwise(() => null);
}

function assertionIsNarrower(
	sourceText: string,
	broadKind: BroadTypeKind,
	evidence: KnownValueEvidence,
	assertedType: ESTree.TSType,
): boolean {
	return match(broadTypeKind(assertedType))
		.with(P.nonNullable, () => false)
		.with(P.nullish, () =>
			match({ kind: broadKind, same: typesHaveSameSyntax(sourceText, evidence.type, assertedType) })
				.with({ kind: 'top' }, () => true)
				.with({ same: true }, () => true)
				.with({ kind: 'object' }, () => isDefinitelyObjectType(assertedType))
				.otherwise(() => isDefinitelyNarrowerRecordType(assertedType)),
		)
		.exhaustive();
}

/** Detect immutable local bindings that erase a known type and are later asserted back to a narrower type. */
export const noWidenThenAssertRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow local const flows that explicitly widen a known value before asserting the widened binding to a narrower type.',
		},
		messages: {
			widenThenAssert:
				'Binding "{{name}}" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.',
		},
	},
	createOnce(context) {
		let scopes: readonly Scope[] = [];

		return {
			Program() {
				scopes = context.sourceCode.scopeManager.scopes;
			},
			'TSAsExpression, TSTypeAssertion'(node: ESTree.TSAsExpression | ESTree.TSTypeAssertion) {
				match(assertedExpression(node))
					.with({ type: 'Identifier', name: P.select() }, (name, expression) =>
						match(resolvedVariableForIdentifier(scopes, expression))
							.with(P.nullish, () => undefined)
							.otherwise((variable) =>
								match(widenedBinding(context.sourceCode, variable, scopes))
									.with(P.nullish, () => undefined)
									.when(
										(widened) => node.start <= widened.declaredAt,
										() => undefined,
									)
									.when(
										(widened) => functionScope(context.sourceCode, node) !== widened.boundary,
										() => undefined,
									)
									.when(
										(widened) =>
											!assertionIsNarrower(
												context.sourceCode.text,
												widened.broadKind,
												widened.evidence,
												node.typeAnnotation,
											),
										() => undefined,
									)
									.otherwise(() => {
										context.report({
											node,
											messageId: 'widenThenAssert',
											data: { name },
										});
									}),
							),
					)
					.otherwise(() => undefined);
			},
		};
	},
});
