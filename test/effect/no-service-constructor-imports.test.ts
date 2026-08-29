import { test } from 'node:test';
import effectPlugin from '@victor-software-house/anti-slop/effect';
import dedent from 'dedent';
import { RuleTester } from 'oxlint/plugins-dev';
import { match, P } from 'ts-pattern';

const rule = match(effectPlugin.rules['no-service-constructor-imports'])
	.with(P.nullish, () => {
		throw new Error("Missing published rule 'no-service-constructor-imports'.");
	})
	.otherwise((value) => value);

await test('anti-slop-effect/no-service-constructor-imports', () => {
	new RuleTester().run('no-service-constructor-imports', rule, {
		valid: [
			{
				filename: 'src/issue-service.test.ts',
				code: 'import { makeIssueService } from "./issue-service.ts";',
			},
			{
				filename: 'src/issue-service.spec.tsx',
				code: 'import { makeIssueService } from "../issue-service.ts";',
			},
			{
				filename: 'src/runtime.ts',
				code: 'import { makeExecutionMemo } from "alchemy/Runtime/ExecutionMemo";',
			},
			{
				filename: 'src/runtime.ts',
				code: dedent`
					import { issueServiceLayer } from "./issue-service.ts";
					WorkspaceName.make("name");
				`,
			},
			{
				filename: 'src/runtime.ts',
				code: 'import { makeissueService } from "./issue-service.ts";',
			},
		],
		invalid: [
			{
				filename: 'src/runtime.ts',
				code: 'import { makeIssueService } from "./issue-service.ts";',
				errors: [
					{
						messageId: 'serviceConstructorImport',
						data: { name: 'makeIssueService' },
					},
				],
				output: null,
			},
			{
				filename: 'src/runtime.ts',
				code: 'import { makeIssueService as createIssueService } from "../issue-service.ts";',
				errors: [
					{
						messageId: 'serviceConstructorImport',
						data: { name: 'makeIssueService' },
					},
				],
				output: null,
			},
		],
	});
});
