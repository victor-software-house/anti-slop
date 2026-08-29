import { test } from 'node:test';
import plugin from '@victor-software-house/anti-slop';
import { RuleTester } from 'oxlint/plugins-dev';
import { match, P } from 'ts-pattern';

const rule = match(plugin.rules['no-reflect-apply'])
	.with(P.nullish, () => {
		throw new Error("Missing published rule 'no-reflect-apply'.");
	})
	.otherwise((value) => value);

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });
const error = { messageId: 'reflectApply' };

await test('anti-slop/no-reflect-apply', () => {
	tester.run('anti-slop/no-reflect-apply', rule, {
		valid: [
			'const value = operation.apply(owner, args);',
			'Reflect.get(owner, key);',
			'const Reflect = { apply() { return 1; } }; Reflect.apply();',
			'function invoke(Reflect: { apply(): number }) { return Reflect.apply(); }',
		],
		invalid: [
			{ code: 'const value = Reflect.apply(operation, owner, args);', errors: [error] },
			{ code: "const value = Reflect['apply'](operation, owner, args);", errors: [error] },
		],
	});
});
