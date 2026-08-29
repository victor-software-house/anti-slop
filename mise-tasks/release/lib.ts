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

export async function registryHasVersion(name: string, version: string): Promise<boolean> {
	const response = await fetch(`https://registry.npmjs.org/${name}/${version}`, {
		headers: { Accept: 'application/vnd.npm.install-v1+json' },
	});
	if (response.status === 200) {
		return true;
	}
	if (response.status === 404) {
		return false;
	}
	throw new Error(`npm registry lookup failed (${response.status}) for ${name}@${version}`);
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
