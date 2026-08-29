#!/usr/bin/env bun
//MISE description="Publish to public npm (OIDC then bun publish in CI)"
//MISE dir="{{ config_root }}"

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env, exit, stdout } from 'node:process';
import {
	name,
	npmOidcPublishToken,
	registryHasVersion,
	thisCommitBumpedVersion,
	version,
} from '@mise-tasks/release/lib';
import { $ } from 'bun';

const specifier = `${name}@${version}`;

if (!(await thisCommitBumpedVersion(version))) {
	stdout.write(`skip publish: HEAD did not bump package.json (${specifier})\n`);
	exit(0);
}

if (await registryHasVersion(name, version)) {
	stdout.write(`skip publish: ${specifier} is already on npm\n`);
	exit(0);
}

if (env['GITHUB_ACTIONS'] === 'true') {
	const token = await npmOidcPublishToken(name, env);
	await $`bun publish --access public --tolerate-republish`.env({
		...env,
		NPM_CONFIG_TOKEN: token,
	});
} else {
	await $`bun publish --access public --tolerate-republish`;
}

for (let attempt = 0; attempt < 12; attempt += 1) {
	if (await registryHasVersion(name, version)) {
		break;
	}
	if (attempt === 11) {
		throw new Error(`npm registry did not observe ${specifier}`);
	}
	await Bun.sleep(5_000);
}

const installDir = await mkdtemp(join(tmpdir(), 'anti-slop-smoke-'));
const cacheDir = await mkdtemp(join(tmpdir(), 'anti-slop-cache-'));
await $`bun add ${specifier}`.cwd(installDir).env({
	...env,
	BUN_INSTALL_CACHE_DIR: cacheDir,
	HOME: installDir,
});
await $`node --input-type=module -e ${`import ${JSON.stringify(name)}`}`.cwd(installDir);
stdout.write(`published and smoked ${specifier}\n`);
