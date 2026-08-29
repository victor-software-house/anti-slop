import { test } from 'node:test';
import plugin from '@victor-software-house/anti-slop';
import { RuleTester } from 'oxlint/plugins-dev';
import { match, P } from 'ts-pattern';

const rule = match(plugin.rules['no-conditional-empty-object-spread'])
	.with(P.nullish, () => {
		throw new Error("Missing published rule 'no-conditional-empty-object-spread'.");
	})
	.otherwise((value) => value);

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });
const error = { messageId: 'avoid' };

await test('anti-slop/no-conditional-empty-object-spread', () => {
	match(rule.meta?.fixable)
		.with(P.nullish, () => undefined)
		.otherwise(() => {
			throw new Error('The rule must not offer an unsafe semantics-changing fix.');
		});

	tester.run('anti-slop/no-conditional-empty-object-spread', rule, {
		valid: [
			'const result = { value };',
			'const result = { ...values };',
			'const result = condition ? { value } : {};',
		],
		invalid: [
			{
				code: 'const result = { ...(value !== undefined ? { value } : {}) };',
				errors: [error],
			},
			{
				code: 'const result = { ...(condition ? {} : { value }) };',
				errors: [error],
			},
		],
	});
});
