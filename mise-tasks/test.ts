#!/usr/bin/env bun

//MISE description="RuleTester files under src/ on Node. Oxlint RuleTester rejects Bun."

import { exit } from 'node:process';
import { Glob } from 'bun';

const files = [...new Glob('src/**/*.test.ts').scanSync('.')].toSorted();
if (files.length === 0) {
	console.error('No RuleTester files under src/');
	exit(1);
}

let failed = 0;
for (const file of files) {
	const proc = Bun.spawnSync({
		cmd: ['node', '--experimental-strip-types', file],
		stdout: 'inherit',
		stderr: 'inherit',
	});
	if (proc.exitCode !== 0) {
		failed += 1;
	}
}

if (failed > 0) {
	exit(1);
}
