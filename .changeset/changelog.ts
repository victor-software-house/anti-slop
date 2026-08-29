import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getInfo } from '@changesets/get-github-info';
import type {
	ChangelogFunctions,
	ModCompWithPackage,
	NewChangesetWithCommit,
	VersionType,
} from '@changesets/types';
import { Liquid } from 'liquidjs';

type PullRequest = {
	number: number;
	url: string;
	user: string | null;
	userUrl: string | null;
};

/**
 * The commit that introduced the changeset.
 *
 * Only used when no PR is associated. A direct push to the base branch has no PR
 * for `getInfo` to find, and an entry with neither link is untraceable — which is
 * what the PR-only template produced for every release in a direct-push flow.
 */
type Commit = {
	short: string;
	url: string;
};

type ChangelogOptions = {
	internalAuthors?: string[];
	repo?: string;
};

type ReleaseTemplateData = {
	commit: Commit | null;
	continuations: string[];
	pullRequest: (PullRequest & { externalAuthor: boolean }) | null;
	summary: string;
	summaryHasTerminal: boolean;
};

const releaseTemplatePath = fileURLToPath(new URL('./changelog.liquid', import.meta.url));
const dependencyTemplatePath = fileURLToPath(
	new URL('./dependency-changelog.liquid', import.meta.url),
);
const liquid = new Liquid({
	cache: true,
	strictFilters: true,
	strictVariables: true,
});
const releaseTemplate = liquid.parse(
	readFileSync(releaseTemplatePath, 'utf8'),
	releaseTemplatePath,
);
const dependencyTemplate = liquid.parse(
	readFileSync(dependencyTemplatePath, 'utf8'),
	dependencyTemplatePath,
);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function getChangelogOptions(value: unknown): ChangelogOptions {
	if (!isRecord(value)) return {};

	const internalAuthors = value['internalAuthors'];
	const repo = value['repo'];
	const options: ChangelogOptions = {};

	if (
		Array.isArray(internalAuthors) &&
		internalAuthors.every((author) => typeof author === 'string')
	) {
		options.internalAuthors = internalAuthors;
	}
	if (typeof repo === 'string') {
		options.repo = repo;
	}

	return options;
}

function markdownLinkUrl(markdown: string): string {
	return markdown.match(/\]\((.+)\)$/)?.[1] ?? '';
}

// Liquid types renderSync as `any`; narrow once here instead of at each call site.
function renderTemplate(
	template: ReturnType<Liquid['parse']>,
	scope: Record<string, unknown>,
): string {
	const rendered: unknown = liquid.renderSync(template, scope);
	return typeof rendered === 'string' ? rendered : '';
}

function renderReleaseTemplate(release: ReleaseTemplateData): string {
	return renderTemplate(releaseTemplate, { release });
}

function renderDependencyTemplate(
	dependencies: Pick<ModCompWithPackage, 'name' | 'newVersion'>[],
): string {
	return renderTemplate(dependencyTemplate, { dependencies });
}

export async function getReleaseLine(
	changeset: NewChangesetWithCommit,
	_type: VersionType,
	options: unknown,
): Promise<string> {
	const { internalAuthors = [], repo } = getChangelogOptions(options);
	const [firstLine = '', ...remaining] = changeset.summary
		.split('\n')
		.map((line) => line.trimEnd());
	let pullRequest: PullRequest | null = null;
	let commit: Commit | null = null;

	if (changeset.commit != null && changeset.commit !== '') {
		if (repo == null || repo === '') {
			throw new Error('options.repo is required for commit-backed releases');
		}

		commit = {
			short: changeset.commit.slice(0, 7),
			url: `https://github.com/${repo}/commit/${changeset.commit}`,
		};

		const info = await getInfo({ repo, commit: changeset.commit });
		if (info.pull != null && info.links.pull != null && info.links.pull !== '') {
			pullRequest = {
				number: info.pull,
				url: markdownLinkUrl(info.links.pull),
				user: info.user,
				userUrl:
					info.links.user != null && info.links.user !== ''
						? markdownLinkUrl(info.links.user)
						: null,
			};
		}
	}

	// The PR is always preferred: it carries the review and the discussion, where a
	// SHA carries only the diff. The SHA is the fallback, never an addition.
	const hasLink = pullRequest != null || commit != null;

	return renderReleaseTemplate({
		commit: pullRequest == null ? commit : null,
		continuations: remaining.map((line) => (line === '' ? '' : line.trim())),
		pullRequest: pullRequest && {
			...pullRequest,
			externalAuthor:
				pullRequest.user != null &&
				pullRequest.user !== '' &&
				pullRequest.userUrl != null &&
				pullRequest.userUrl !== '' &&
				!internalAuthors.includes(pullRequest.user),
		},
		summary: hasLink ? firstLine.replace(/\.+$/, '') : firstLine,
		// A colon or semicolon terminates the line too: a summary ending in ':'
		// introduces the bullet list that follows, and appending '.' yields ':.'.
		summaryHasTerminal: /[.!?:;]$/.test(firstLine),
	});
}

export async function getDependencyReleaseLine(
	_changesets: NewChangesetWithCommit[],
	dependenciesUpdated: ModCompWithPackage[],
	_options: unknown,
): Promise<string> {
	if (dependenciesUpdated.length === 0) return '';

	return renderDependencyTemplate(dependenciesUpdated);
}

const changelogFunctions: ChangelogFunctions = {
	getReleaseLine,
	getDependencyReleaseLine,
};

// Changesets resolves the adapter through its default export.
// oxlint-disable-next-line import/no-default-export
export default changelogFunctions;
