# @victor-software-house/anti-slop

Published fork of [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop).
Generic rules in `src/index.ts`. Effect rules in `src/effect/`.

npm name is **`@victor-software-house/anti-slop`**. Unscoped `anti-slop` is blocked
by npm as too similar to existing `antislop`. GitHub is
`victor-software-house/anti-slop`. Rule prefixes stay `anti-slop/` via the
plugin `meta.name`.

## Invariants

- Rules use `createOnce` + `eslintCompatPlugin`, not ESLint `create`. Per-file
  setup belongs in `before`. Do not read `context.filename` / `sourceCode` in
  the `createOnce` body.
- `@oxlint/plugins` is a runtime dependency. Do not move it to
  `devDependencies` or bundle it.
- JS plugins have no type-aware APIs. Do not add rules that need the type checker.
- Tests use `RuleTester` from `oxlint/plugins-dev` and must run on Node.
  Oxlint's RuleTester refuses Bun (`global.Bun`). Tests live in `test/` and
  import `@victor-software-house/anti-slop` against `dist`. `mise run test`
  depends on `build` and runs `node --experimental-strip-types --test test/`.
- Upstream SHA is `6d538555cb151d4121ed51a27db81890eacf8ae9`. Inspect the
  upstream diff before bumping.

## Tasks

```bash
mise run verify
```

## Release discipline

Versioning is changeset-driven after a one-time `0.0.0` bootstrap.

1. First published version is **`0.0.0`**, shipped by the initial commit with **no** changeset file. Operator publishes it once (`bun publish --access public`), tags `v0.0.0`, and configures npm trusted publishing for `.github/workflows/release.yml`.
2. Later functional PRs add a `.changeset/*.md` file. Default bump is `patch`.
3. `changesets/action` opens a **Version Packages** PR. Operator merges it → CI publishes via OIDC.

- Never run `changeset version` or `changeset publish` locally.
- Never hand-edit versions in `package.json` or `CHANGELOG.md` after the `0.0.0` scaffold.
- Never `major` on `0.x` unless explicitly decided.
- No `NPM_TOKEN` in workflows.
- Runners are GitHub-hosted `ubuntu-24.04`.
