import { test } from 'node:test';
import plugin from '@victor-software-house/anti-slop';
import { RuleTester } from 'oxlint/plugins-dev';
import { match, P } from 'ts-pattern';

const rule = match(plugin.rules['no-reflect-get'])
	.with(P.nullish, () => {
		throw new Error("Missing published rule 'no-reflect-get'.");
	})
	.otherwise((value) => value);

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });
const error = { messageId: 'reflectGet' };

await test('anti-slop/no-reflect-get', () => {
	tester.run('anti-slop/no-reflect-get', rule, {
		valid: [
			'const value = owner.property;',
			'const value = owner[key];',
			'Reflect.set(owner, key, value);',
			'const Reflect = { get() { return 1; } }; Reflect.get();',
			'function read(Reflect: { get(): number }) { return Reflect.get(); }',
		],
		invalid: [
			{ name: 'static access', code: 'const value = Reflect.get(owner, key);', errors: [error] },
			{
				name: 'computed access',
				code: "const value = Reflect['get'](owner, key);",
				errors: [error],
			},
		],
	});
});
