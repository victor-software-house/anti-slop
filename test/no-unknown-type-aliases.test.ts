import { test } from 'node:test';
import plugin from '@victor-software-house/anti-slop';
import { RuleTester } from 'oxlint/plugins-dev';
import { match, P } from 'ts-pattern';

const rule = match(plugin.rules['no-unknown-type-aliases'])
	.with(P.nullish, () => {
		throw new Error("Missing published rule 'no-unknown-type-aliases'.");
	})
	.otherwise((value) => value);

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });
const error = { messageId: 'unknownAlias' };

await test('anti-slop/no-unknown-type-aliases', () => {
	tester.run('anti-slop/no-unknown-type-aliases', rule, {
		valid: ['type User = { readonly id: string };', 'type Alias = string; type UserId = Alias;'],
		invalid: [
			{ code: 'type Alias = unknown;', errors: [error] },
			{ code: 'type Current = unknown;', errors: [error] },
			{ code: 'type UnknownValue = unknown; type Alias = UnknownValue;', errors: [error, error] },
		],
	});
});
