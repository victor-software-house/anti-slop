import { $ } from 'bun';
import { match, P } from 'ts-pattern';

export { name, version } from '@repo/package.json' with { type: 'json' };

export async function thisCommitBumpedVersion(version: string): Promise<boolean> {
	const shown = await $`git show ${'HEAD^:package.json'}`.nothrow().quiet();
	if (shown.exitCode !== 0) {
		return false;
	}
	return match(JSON.parse(shown.stdout.toString()))
		.with({ version: P.string }, ({ version: parent }) => parent !== version)
		.otherwise(() => false);
}

export const NPM_REGISTRY = 'https://registry.npmjs.org/';

function npmOidcExchangeUrl(packageName: string, registry = NPM_REGISTRY): URL {
	return new URL(
		`/-/npm/v1/oidc/token/exchange/package/${packageName.replace('/', '%2F')}`,
		registry,
	);
}

export async function npmOidcPublishToken(
	packageName: string,
	environ: NodeJS.ProcessEnv,
	registry = NPM_REGISTRY,
): Promise<string> {
	const requestUrl = environ['ACTIONS_ID_TOKEN_REQUEST_URL'];
	const requestToken = environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN'];
	if (
		requestUrl === undefined ||
		requestUrl === '' ||
		requestToken === undefined ||
		requestToken === ''
	) {
		throw new Error(
			'OIDC publish needs ACTIONS_ID_TOKEN_REQUEST_URL and ACTIONS_ID_TOKEN_REQUEST_TOKEN',
		);
	}

	const githubUrl = new URL(requestUrl);
	githubUrl.searchParams.set('audience', `npm:${new URL(registry).hostname}`);
	const github = await fetch(githubUrl, {
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${requestToken}`,
		},
	});
	if (!github.ok) {
		throw new Error(`GitHub OIDC token request failed (${github.status})`);
	}
	const githubBody: unknown = await github.json();
	const idToken = match(githubBody)
		.with({ value: P.string.minLength(1) }, ({ value }) => value)
		.otherwise(() => {
			throw new Error('GitHub OIDC token request missing value');
		});

	const exchange = await fetch(npmOidcExchangeUrl(packageName, registry), {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${idToken}`,
		},
	});
	if (!exchange.ok) {
		throw new Error(`npm OIDC token exchange failed (${exchange.status})`);
	}
	const exchangeBody: unknown = await exchange.json();
	return match(exchangeBody)
		.with({ token: P.string.minLength(1) }, ({ token }) => token)
		.otherwise(() => {
			throw new Error('npm OIDC token exchange missing token');
		});
}

export async function registryHasVersion(name: string, version: string): Promise<boolean> {
	const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, {
		headers: { Accept: 'application/vnd.npm.install-v1+json' },
	});
	if (response.status === 404) {
		return false;
	}
	if (!response.ok) {
		throw new Error(`npm registry lookup failed (${response.status}) for ${name}@${version}`);
	}
	const body: unknown = await response.json();
	return match(body)
		.with({ versions: P.record(P.string, P.unknown) }, ({ versions }) => version in versions)
		.otherwise(() => {
			throw new Error(`npm registry packument missing versions for ${name}@${version}`);
		});
}

export function changelogSection(changelog: string, version: string): string {
	const heading = `## ${version}`;
	const lines = changelog.split(/\r?\n/);
	const start = lines.indexOf(heading);
	if (start === -1) {
		throw new Error(`No CHANGELOG.md section found for ${version}`);
	}
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) => line.startsWith('## '));
	const section = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
	if (section === '') {
		throw new Error(`No CHANGELOG.md section found for ${version}`);
	}
	return section;
}

export function peeledTagSha(lsRemote: string, tag: string): string | undefined {
	const suffix = `refs/tags/${tag}`;
	const peeledSuffix = `${suffix}^{}`;
	let direct: string | undefined;
	let peeled: string | undefined;
	for (const line of lsRemote.split('\n')) {
		const [sha, ref] = line.split('\t');
		if (sha === undefined || sha === '' || ref === undefined) {
			continue;
		}
		if (ref === peeledSuffix) {
			peeled = sha;
		} else if (ref === suffix) {
			direct = sha;
		}
	}
	return peeled ?? direct;
}
