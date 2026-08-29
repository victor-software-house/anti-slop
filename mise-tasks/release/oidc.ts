#!/usr/bin/env bun
//MISE description="Mint a short-lived npm OIDC token into BUN_CONFIG_TOKEN"
//MISE dir="{{ config_root }}"

import { appendFile } from 'node:fs/promises';
import { env, stdout } from 'node:process';
import { name, npmOidcPublishToken } from '@mise-tasks/release/lib';

const githubEnv = env['GITHUB_ENV'];
if (githubEnv === undefined || githubEnv === '') {
	throw new Error('release:oidc writes BUN_CONFIG_TOKEN to GITHUB_ENV (CI only)');
}

const token = await npmOidcPublishToken(name, env);
stdout.write(`::add-mask::${token}\n`);
await appendFile(githubEnv, `BUN_CONFIG_TOKEN=${token}\n`);
