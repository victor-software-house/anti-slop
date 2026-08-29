# @victor-software-house/anti-slop

Public npm fork of [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) at
`6d538555cb151d4121ed51a27db81890eacf8ae9`.

Rules use Oxlint's [alternative `createOnce` API](https://oxc.rs/docs/guide/usage/linter/writing-js-plugins.md)
wrapped with `eslintCompatPlugin`. `@oxlint/plugins` is a runtime dependency, as
the oxlint docs require for a published plugin.

Do not vendor this into a consumer. Depend on the package.

## Install

```bash
bun add -D @victor-software-house/anti-slop oxlint @oxlint/plugins
```

Pin `@oxlint/plugins` to the same oxlint major as the consumer.

## Usage

JSON and TypeScript oxlint configs cannot coexist. Prefer `oxlint.config.ts`:

```ts
import { defineConfig } from 'oxlint';

export default defineConfig({
	jsPlugins: [
		{
			name: 'anti-slop',
			specifier: '@victor-software-house/anti-slop',
		},
	],
	rules: {
		'anti-slop/no-chained-type-assertions': 'error',
		'anti-slop/no-conditional-empty-object-spread': 'error',
		'anti-slop/no-known-value-widening': 'error',
		'anti-slop/no-module-mocking': 'error',
		'anti-slop/no-object-parameters': 'error',
		'anti-slop/no-reflect-apply': 'error',
		'anti-slop/no-reflect-get': 'error',
		'anti-slop/no-runtime-typeof': 'error',
		'anti-slop/no-shape-in-symbol-names': 'error',
		'anti-slop/no-unknown-parameters': 'error',
		'anti-slop/no-unknown-returns': 'error',
		'anti-slop/no-unknown-type-aliases': 'error',
		'anti-slop/no-unsafe-dictionary-type': 'error',
		'anti-slop/no-widen-then-assert': 'error',
		'anti-slop/require-safety-comment-for-type-assertion': 'error',
	},
});
```

Effect-specific rules are a separate entry. Register them only in Effect repos:

```ts
jsPlugins: [
	{
		name: 'anti-slop',
		specifier: '@victor-software-house/anti-slop',
	},
	{
		name: 'anti-slop-effect',
		specifier: '@victor-software-house/anti-slop/effect',
	},
],
```

The Effect plugin's `meta.name` is `anti-slop-effect`, so those rules are
`anti-slop-effect/no-service-constructor-imports`.

JS plugins cannot use TypeScript type-aware APIs. These rules are syntactic.
