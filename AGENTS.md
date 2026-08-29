# @victor-software-house/anti-slop

Published Oxlint JS plugin. Generic rules from [`src/index.ts`](./src/index.ts).
Effect rules from [`src/effect/index.ts`](./src/effect/index.ts).

The npm name is **`@victor-software-house/anti-slop`**. Unscoped `anti-slop` is
blocked as too similar to existing `antislop`. GitHub is
[`victor-software-house/anti-slop`][repo]. Rule prefixes stay `anti-slop/` and
`anti-slop-effect/` via each plugin `meta.name`.

[`CLAUDE.md`](./CLAUDE.md) is only `@AGENTS.md`. Do not give it a second copy of
this file.

## Layout

| Path | Role |
| --- | --- |
| [`src/index.ts`](./src/index.ts) | Generic plugin |
| [`src/effect/`](./src/effect/) | Effect plugin |
| [`src/rules/`](./src/rules/) | Generic rule implementations |
| [`src/shared/environment.ts`](./src/shared/environment.ts) | `TypeEnvironment` (`empty` / `fromProgram`) |
| [`src/shared/query.ts`](./src/shared/query.ts) | Substitution walker |
| [`src/shared/transparent-type.ts`](./src/shared/transparent-type.ts) | Wrapper unwrapping, builtins, empty-shape checks |
| [`src/shared/evidence.ts`](./src/shared/evidence.ts) | Known-value expression unwrapping |
| [`src/shared/resolve-variable.ts`](./src/shared/resolve-variable.ts) | Scope binding lookup |
| [`src/shared/reflect-method.ts`](./src/shared/reflect-method.ts) | Global `Reflect` method calls |
| [`src/shared/lexical-type-parameters.ts`](./src/shared/lexical-type-parameters.ts) | In-scope type parameter names |
| [`test/`](./test/) | Node `RuleTester` against `dist` |

Source imports use `@anti-slop/*`. `mise-tasks` imports use `@mise-tasks/*`.
The root manifest is `@repo/package.json`. Relative imports are forbidden.
Public package exports are `.` and `./effect` → `dist`.

## Invariants

- Rules use `createOnce` + `eslintCompatPlugin`, not ESLint `create`. Per-file
  setup belongs in `before`. Do not read `context.filename` / `sourceCode` in
  the `createOnce` body.
- [`@oxlint/plugins`][oxlint-plugins] is a runtime dependency. Do not move it to
  `devDependencies` or bundle it.
- JS plugins have no type-aware APIs. Do not add rules that need the type
  checker.
- Walk the AST with selectors, one parent peek, `getScope`, and looking down.
  Do not use `getAncestors`, visit stacks, `scope.upper` walks, or `matchAst`.
- File-level TypeScript names live on `TypeEnvironment`. Start from
  `TypeEnvironment.empty()`, replace it in `Program` with
  `TypeEnvironment.fromProgram`. Classify through the instance.
- Tests use `RuleTester` from `oxlint/plugins-dev` and must run on Node.
  Oxlint's RuleTester refuses Bun (`global.Bun`). Tests live in `test/` and
  import `@victor-software-house/anti-slop` against `dist`.
- `mise run test`, `mise run typecheck`, and `mise run lint:oxlint` depend on
  `build`. Type-aware oxlint on those tests needs a complete `dist`.
- This repo's oxlint JS plugin loads `./src/index.ts`. Node does not resolve
  tsconfig paths, so `lint:oxlint` / `lint:fix` run `bun --bun oxlint`.
- Upstream origin is [`dmmulroy/anti-slop`][upstream] at
  `6d538555cb151d4121ed51a27db81890eacf8ae9`. Inspect the upstream diff before
  bumping that pin. Do not reintroduce vendoring, skill-asset sync, or their
  install skill as this package's distribution story.

## Tasks

```bash
mise run verify
```

## Release discipline

Versioning is **changeset-driven — CI owns the bump, publish, tag, and GitHub
Release.** Registry is public npm with OIDC trusted publishing. Runners are
GitHub-hosted `ubuntu-24.04`. This package has no native binaries; a GitHub
Release is changelog notes plus the `v*` tag.

1. Author a `.changeset/*.md` file. Default bump is `patch`.
2. Commit and push to `main` (or merge a PR).
3. `changesets/action` opens a **"Version Packages" PR** (`mise run version` →
   `changeset version` + `bun update --lockfile-only`). The PR title is the
   commit title (`chore(release): version packages`).
4. Operator merges that PR. GitHub deletes the head branch
   (`delete_branch_on_merge`). CI then runs `mise run release`, then
   `mise run release:tags`.

   If squash-merging from the web UI, clear the generated `Co-authored-by:`
   trailer. GitHub injects it whenever it generates the squash message; that is
   not a repository setting.

`0.0.0` was a one-time bootstrap: operator `bun publish --access public` with a
local npmjs token, tag `v0.0.0`, then `npm trust` for
[`.github/workflows/release.yml`](./.github/workflows/release.yml). Later
versions are `0.0.1` onward from patch changesets. That local path is not OIDC.

- **Never run `changeset version` or `changeset publish` locally.** Never
  hand-edit `package.json` version or `CHANGELOG.md` after the `0.0.0` scaffold.
- **CI publishes with `bun publish --access public`.** There is no npm OIDC
  library (`libnpmpublish` still does not export it — npm/cli#9503). The
  release task does the two-call handshake itself (GitHub `id-token` → npm
  `/-/npm/v1/oidc/token/exchange/package/…`), then sets `NPM_CONFIG_TOKEN` for
  bun. Do not use `bunx npm` or `NPM_CONFIG_FORCE`. If the version is already
  on the registry, `mise run release` skips before publish. Local emergency
  publish is the same `bun publish` with an operator npmjs token.
- Do not add `NPM_TOKEN` / `NODE_AUTH_TOKEN`. Do not pass `publish:` to
  `changesets/action` — that forfeits explicit tags and GitHub Releases.
- Bun is the package manager (`packageManager` + `devEngines.packageManager`).
  Node is the plugin runtime (`engines.node` + `devEngines.runtime`).
- [`bunfig.toml`](./bunfig.toml) pins `@victor-software-house` to
  `registry.npmjs.org`. Bun has no per-package registry key.
- Never `major` on `0.x` unless explicitly decided.

## Attribution

Rule ideas originated in [dmmulroy/anti-slop][upstream]. This repository is
owned and published by [Victor Software House][vsh]. MIT in [`LICENSE`](./LICENSE):
Dillon Mulroy's copyright notice is retained; Victor Araújo's is listed under
it.

[repo]: https://github.com/victor-software-house/anti-slop
[vsh]: https://github.com/victor-software-house
[upstream]: https://github.com/dmmulroy/anti-slop
[oxlint-plugins]: https://oxc.rs/docs/guide/usage/linter/writing-js-plugins.md
