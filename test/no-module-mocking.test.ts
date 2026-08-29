import { test } from 'node:test';
import plugin from '@victor-software-house/anti-slop';
import { RuleTester } from 'oxlint/plugins-dev';
import { match, P } from 'ts-pattern';

const rule = match(plugin.rules['no-module-mocking'])
	.with(P.nullish, () => {
		throw new Error("Missing published rule 'no-module-mocking'.");
	})
	.otherwise((value) => value);

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });
const error = { messageId: 'moduleMock' };

await test('anti-slop/no-module-mocking', () => {
	tester.run('anti-slop/no-module-mocking', rule, {
		valid: [
			'const store = new InMemoryUserStore();',
			"vi.spyOn(store, 'save');",
			'const vi = { mock() {} }; vi.mock();',
			'function test(jest: { mock(): void }) { jest.mock(); }',
			"import { vi as localVi } from './helpers'; localVi.mock('./module');",
		],
		invalid: [
			{ code: "vi.mock('./user-store');", errors: [error] },
			{ code: "jest.mock('./user-store');", errors: [error] },
			{ code: "vi['doMock']('./user-store');", errors: [error] },
			{ code: "jest.unstable_mockModule('./user-store');", errors: [error] },
			{ code: "import { vi } from 'vitest'; vi.mock('./user-store');", errors: [error] },
			{
				code: "import { vi as testApi } from 'vitest'; testApi.mock('./user-store');",
				errors: [error],
			},
			{
				code: "import { jest } from '@jest/globals'; jest.mock('./user-store');",
				errors: [error],
			},
		],
	});
});
