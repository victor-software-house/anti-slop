import { test } from 'node:test';
import plugin from '@victor-software-house/anti-slop';
import dedent from 'dedent';
import { RuleTester } from 'oxlint/plugins-dev';
import { match, P } from 'ts-pattern';

const rule = match(plugin.rules['require-safety-comment-for-type-assertion'])
	.with(P.nullish, () => {
		throw new Error("Missing published rule 'require-safety-comment-for-type-assertion'.");
	})
	.otherwise((value) => value);

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });
const error = { messageId: 'missingSafetyComment' };

await test('anti-slop/require-safety-comment-for-type-assertion', () => {
	tester.run('anti-slop/require-safety-comment-for-type-assertion', rule, {
		valid: [
			'const values = [1, 2] as const;',
			"const value = <const>{ id: 'one' };",
			dedent`
				// SAFETY: The parser established the UserId invariant.
				const id = value as UserId;
			`,
			dedent`
				function parse(): UserId {
				// SAFETY: Validation above established the UserId invariant.
				return value as UserId;
				}
			`,
			'const id = /* SAFETY: Validation established the invariant. */ value as UserId;',
		],
		invalid: [
			{ code: 'const id = value as UserId;', errors: [error] },
			{ code: 'const id = <UserId>value;', errors: [error] },
			{ code: 'const id = value as UserId; // SAFETY: Too late.', errors: [error] },
			{
				code: dedent`
					// This cast seems fine.
					const id = value as UserId;
				`,
				errors: [error],
			},
		],
	});
});
