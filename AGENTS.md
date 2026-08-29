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

Source imports use `@anti-slop/*`. Relative imports are forbidden. Public
package exports are `.` and `./effect` → `dist`.

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

Versioning is changeset-driven after a one-time `0.0.0` bootstrap.

1. First published version is **`0.0.0`**, shipped by the initial commit with
   **no** changeset file. Operator publishes it once
   (`bun publish --access public`), tags `v0.0.0`, and configures npm trusted
   publishing for [`.github/workflows/release.yml`](./.github/workflows/release.yml).
2. Later functional PRs add a `.changeset/*.md` file. Default bump is `patch`.
3. `changesets/action` opens a "Version Packages" PR. Operator merges it → CI
   publishes via OIDC.

- Never run `changeset version` or `changeset publish` locally.
- Never hand-edit versions in `package.json` or `CHANGELOG.md` after the
  `0.0.0` scaffold.
- Never `major` on `0.x` unless explicitly decided.
- No `NPM_TOKEN` in workflows.
- Runners are GitHub-hosted `ubuntu-24.04`.

## Attribution

Rule ideas originated in [dmmulroy/anti-slop][upstream]. This repository is
owned and published by [Victor Software House][vsh]. MIT in [`LICENSE`](./LICENSE):
Dillon Mulroy's copyright notice is retained; Victor Araújo's is listed under
it.

[repo]: https://github.com/victor-software-house/anti-slop
[vsh]: https://github.com/victor-software-house
[upstream]: https://github.com/dmmulroy/anti-slop
[oxlint-plugins]: https://oxc.rs/docs/guide/usage/linter/writing-js-plugins.md
