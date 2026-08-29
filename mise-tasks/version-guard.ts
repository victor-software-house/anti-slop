#!/usr/bin/env bun
//MISE description="Block local package.json version drift from origin/main"

import { env, exit } from 'node:process';
import { match, P } from 'ts-pattern';

if (env['CI'] === 'true') {
	exit(0);
}

const branchProc = Bun.spawnSync({
	cmd: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
	stdout: 'pipe',
});
const branch = branchProc.stdout.toString().trim();
if (branch.startsWith('changeset-release/')) {
	exit(0);
}

Bun.spawnSync({
	cmd: ['git', 'fetch', 'origin', 'main', '--quiet'],
	stderr: 'ignore',
});

const filesProc = Bun.spawnSync({
	cmd: ['git', 'ls-files', 'package.json', '*/package.json'],
	stdout: 'pipe',
});
const files = filesProc.stdout
	.toString()
	.split('\n')
	.filter((line) => line !== '');

let errors = 0;
for (const file of files) {
	const remote = Bun.spawnSync({
		cmd: ['git', 'show', `origin/main:${file}`],
		stdout: 'pipe',
		stderr: 'ignore',
	});
	if (remote.exitCode !== 0) {
		continue;
	}
	const remoteVersion = packageVersion(remote.stdout.toString());
	const localVersion = packageVersion(await Bun.file(file).text());
	if (remoteVersion !== undefined && remoteVersion !== localVersion) {
		console.error(`BLOCKED: ${file} version changed locally (${remoteVersion} → ${localVersion})`);
		console.error('  Versions are CI-managed via changesets.');
		errors += 1;
	}
}

if (errors > 0) {
	exit(1);
}

function packageVersion(text: string): string | undefined {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return undefined;
	}
	return match(value)
		.with({ version: P.string }, ({ version }) => version)
		.otherwise(() => undefined);
}
