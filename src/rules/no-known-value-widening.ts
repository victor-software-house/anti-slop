import type { TypeEnvironment, WideningTarget } from '@anti-slop/shared/dictionary-types';
import {
	classifyWideningTarget,
	createTypeEnvironment,
	isKnownEvidenceExpression,
	unwrapEvidenceWrappers,
} from '@anti-slop/shared/dictionary-types';
import type { ESTree, SourceCode, Variable } from '@oxlint/plugins';
import { defineRule } from '@oxlint/plugins';
import { isMatching, match, P } from 'ts-pattern';

type FunctionExpression = ESTree.ArrowFunctionExpression | ESTree.Function;

function isFunctionLike(node: ESTree.Node): node is FunctionExpression {
	return isMatching(
		{
			type: P.union(
				'ArrowFunctionExpression',
				'FunctionDeclaration',
				'FunctionExpression',
				'TSDeclareFunction',
				'TSEmptyBodyFunctionExpression',
			),
		},
		node,
	);
}

function isTypeAssertionExpression(
	node: ESTree.Node,
): node is ESTree.TSAsExpression | ESTree.TSTypeAssertion {
	return isMatching({ type: P.union('TSAsExpression', 'TSTypeAssertion') }, node);
}

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

function variableDeclarator(variable: Variable): ESTree.VariableDeclarator | null {
	return match(variable.defs)
		.with([{ type: 'Variable', node: { type: 'VariableDeclarator' } }], ([{ node }]) => node)
		.otherwise(() => null);
}

function isStableConstVariable(variable: Variable, declarator: ESTree.VariableDeclarator): boolean {
	return match({
		constDecl: isMatching({ type: 'VariableDeclaration', kind: 'const' }, declarator.parent),
		stable: variable.references.every((reference) => reference.init || !reference.isWrite()),
	})
		.returnType<boolean>()
		.with({ constDecl: true, stable: true }, () => true)
		.otherwise(() => false);
}

function hasKnownEvidence(
	sourceCode: SourceCode,
	expression: ESTree.Expression,
	visitedVariables = new Set<Variable>(),
): boolean {
	return match(isKnownEvidenceExpression(expression))
		.returnType<boolean>()
		.with(true, () => true)
		.otherwise(() =>
			match(unwrapEvidenceWrappers(expression))
				.returnType<boolean>()
				.with({ type: 'Identifier' }, (identifier) =>
					match(resolveVariable(sourceCode, identifier))
						.returnType<boolean>()
						.with(P.nullish, () => false)
						.when(
							(variable) => visitedVariables.has(variable),
							() => false,
						)
						.otherwise((variable) =>
							match(variableDeclarator(variable))
								.returnType<boolean>()
								.with({ init: P.nonNullable }, (declarator) =>
									match(isStableConstVariable(variable, declarator))
										.returnType<boolean>()
										.with(true, () => {
											visitedVariables.add(variable);
											return hasKnownEvidence(sourceCode, declarator.init, visitedVariables);
										})
										.otherwise(() => false),
								)
								.otherwise(() => false),
						),
				)
				.otherwise(() => false),
		);
}

function annotationTarget(
	annotation: ESTree.TSTypeAnnotation | null | undefined,
	environment: TypeEnvironment,
): WideningTarget | null {
	return match(annotation)
		.with(P.nullish, () => null)
		.otherwise((value) => classifyWideningTarget(value.typeAnnotation, environment));
}

function functionName(
	owner: FunctionExpression | undefined,
	boundNames: WeakMap<FunctionExpression, string>,
): string {
	return match(owner)
		.with(P.nullish, () => 'anonymous function')
		.with({ id: { type: 'Identifier', name: P.select() } }, (name) => name)
		.otherwise((fn) => boundNames.get(fn) ?? 'anonymous function');
}

function enclosingFunction(
	sourceCode: SourceCode,
	node: ESTree.Node,
): FunctionExpression | undefined {
	const block = sourceCode.getScope(node).variableScope.block;
	if (!isFunctionLike(block)) {
		return undefined;
	}
	return block;
}

function sourceKeyName(sourceCode: SourceCode, key: ESTree.PropertyKey): string {
	return match(key)
		.with({ type: P.union('Identifier', 'PrivateIdentifier'), name: P.select() }, (name) => name)
		.with({ type: 'Literal' }, ({ value }) => String(value))
		.otherwise((current) => sourceCode.getText(current));
}

function isEmptyObjectExpression(expression: ESTree.Expression): boolean {
	return match(unwrapEvidenceWrappers(expression))
		.with({ type: 'ObjectExpression', properties: [] }, () => true)
		.otherwise(() => false);
}

function isDictionaryAccumulatorTarget(destination: WideningTarget): boolean {
	return match(destination.kind)
		.with(P.union('open dictionary', 'generic container'), () => true)
		.otherwise(() => false);
}

/** Detect sound syntactic cases where a known value is explicitly widened and loses evidence. */
export const noKnownValueWideningRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow syntactically established values from flowing into explicitly broad or anonymous target types that discard useful evidence.',
		},
		messages: {
			widening:
				'The explicit {{target}} type on {{subject}} discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.',
		},
	},
	createOnce(context) {
		let environment: TypeEnvironment | null = null;
		const boundNames = new WeakMap<FunctionExpression, string>();

		const reportFlow = (
			expression: ESTree.Expression,
			destination: WideningTarget | null,
			subject: string,
		) =>
			match(destination)
				.with(P.nullish, () => undefined)
				.when(
					(target) => isDictionaryAccumulatorTarget(target) && isEmptyObjectExpression(expression),
					() => undefined,
				)
				.when(
					(_target) => !hasKnownEvidence(context.sourceCode, expression),
					() => undefined,
				)
				.otherwise((target) => {
					context.report({
						node: expression,
						messageId: 'widening',
						data: { subject, target: target.kind },
					});
				});

		const targetFromAnnotation = (annotation: ESTree.TSTypeAnnotation | null | undefined) =>
			match(environment)
				.with(P.nullish, () => null)
				.otherwise((env) => annotationTarget(annotation, env));

		const bindFunctionName = (expression: ESTree.Expression | null | undefined, name: string) => {
			match(expression)
				.with(
					{ type: P.union('ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration') },
					(fn) => {
						boundNames.set(fn, name);
					},
				)
				.otherwise(() => undefined);
		};

		const checkAssertion = (node: ESTree.Node) => {
			if (!isTypeAssertionExpression(node)) {
				return;
			}
			match(environment)
				.with(P.nonNullable, (env) =>
					reportFlow(
						node.expression,
						classifyWideningTarget(node.typeAnnotation, env),
						'assertion',
					),
				)
				.otherwise(() => undefined);
		};

		return {
			Program(node) {
				environment = createTypeEnvironment(node);
			},
			ArrowFunctionExpression(node) {
				match(node.body)
					.with({ type: 'BlockStatement' }, () => undefined)
					.otherwise((body) => {
						reportFlow(
							body,
							targetFromAnnotation(node.returnType),
							`return value of \`${functionName(node, boundNames)}\``,
						);
					});
			},
			VariableDeclarator(node) {
				match(node)
					.with(
						{
							init: P.select('init', P.nonNullable),
							id: {
								type: 'Identifier',
								name: P.select('name'),
								typeAnnotation: P.select('annotation'),
							},
						},
						({ init, name, annotation }) => {
							bindFunctionName(init, name);
							reportFlow(init, targetFromAnnotation(annotation), `binding \`${name}\``);
						},
					)
					.otherwise(() => undefined);
			},
			PropertyDefinition(node) {
				match(node)
					.with(
						{
							value: P.select('value', P.nonNullable),
							typeAnnotation: P.select('annotation'),
							key: P.select('key'),
						},
						({ value, annotation, key }) =>
							reportFlow(
								value,
								targetFromAnnotation(annotation),
								`property \`${sourceKeyName(context.sourceCode, key)}\``,
							),
					)
					.otherwise(() => undefined);
			},
			AccessorProperty(node) {
				match(node)
					.with(
						{
							value: P.select('value', P.nonNullable),
							typeAnnotation: P.select('annotation'),
							key: P.select('key'),
						},
						({ value, annotation, key }) =>
							reportFlow(
								value,
								targetFromAnnotation(annotation),
								`property \`${sourceKeyName(context.sourceCode, key)}\``,
							),
					)
					.otherwise(() => undefined);
			},
			MethodDefinition(node) {
				match(node)
					.with({ key: P.select('key'), value: P.select('value') }, ({ key, value }) => {
						bindFunctionName(value, sourceKeyName(context.sourceCode, key));
					})
					.otherwise(() => undefined);
			},
			AssignmentExpression(node) {
				match(node)
					.with(
						{ operator: '=', left: { type: 'Identifier', name: P.select() } },
						(name, { left, right }) => {
							bindFunctionName(right, name);
							return match(resolveVariable(context.sourceCode, left))
								.with(P.nullish, () => undefined)
								.otherwise((variable) =>
									match(variableDeclarator(variable))
										.with(
											{
												id: {
													type: 'Identifier',
													name: P.select('name'),
													typeAnnotation: P.select('annotation'),
												},
											},
											({ name: bindingName, annotation }) =>
												reportFlow(
													right,
													targetFromAnnotation(annotation),
													`binding \`${bindingName}\``,
												),
										)
										.otherwise(() => undefined),
								);
						},
					)
					.otherwise(() => undefined);
			},
			ReturnStatement(node) {
				match(node.argument)
					.with(P.nullish, () => undefined)
					.otherwise((argument) => {
						const owner = enclosingFunction(context.sourceCode, node);
						reportFlow(
							argument,
							targetFromAnnotation(owner?.returnType),
							`return value of \`${functionName(owner, boundNames)}\``,
						);
					});
			},
			'TSAsExpression:not(TSAsExpression TSAsExpression, TSTypeAssertion TSAsExpression)':
				checkAssertion,
			'TSTypeAssertion:not(TSAsExpression TSTypeAssertion, TSTypeAssertion TSTypeAssertion)':
				checkAssertion,
		};
	},
});
