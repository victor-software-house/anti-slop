import { test } from 'node:test';
import plugin from '@victor-software-house/anti-slop';
import { RuleTester } from 'oxlint/plugins-dev';
import { match, P } from 'ts-pattern';

const rule = match(plugin.rules['no-widen-then-assert'])
	.with(P.nullish, () => {
		throw new Error("Missing published rule 'no-widen-then-assert'.");
	})
	.otherwise((value) => value);

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });
const error = { messageId: 'widenThenAssert' };

await test('anti-slop/no-widen-then-assert', () => {
	tester.run('anti-slop/no-widen-then-assert', rule, {
		valid: [
			"const source = { id: 'first' }; const widened: unknown = source;",
			'declare const input: unknown; const parsed = input as { readonly id: string };',
		],
		invalid: [
			{
				code: "const source = { id: 'second' }; const widened: unknown = source; const parsed = widened as { readonly id: string };",
				errors: [error],
			},
		],
	});
});
