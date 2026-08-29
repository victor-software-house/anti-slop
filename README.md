# @victor-software-house/anti-slop

Oxlint JS-plugin rules that reject low-evidence TypeScript: broad `unknown` /
`object` contracts, discarded inference, module mocks, and assertion chains
that invent precision.

Install the package. Do not copy `src/` into a consumer.

## Install

```bash
bun add -D @victor-software-house/anti-slop oxlint @oxlint/plugins
```

Pin `oxlint` and `@oxlint/plugins` to the same major. JSON and TypeScript
oxlint configs cannot coexist; prefer `oxlint.config.ts`.

## Usage

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

JS plugins have no type-checker APIs. These rules are syntactic.

### Effect

Register the Effect entry only in Effect repos. Its `meta.name` is
`anti-slop-effect`:

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
rules: {
	'anti-slop-effect/no-service-constructor-imports': 'error',
},
```

## Rules

| Rule | Rejects |
| --- | --- |
| `no-chained-type-assertions` | Nested `as` / angle-bracket assertions |
| `no-conditional-empty-object-spread` | `...(cond ? { field } : {})` omission |
| `no-known-value-widening` | Known values annotated as `unknown`, `object`, open dictionaries, or anonymous objects |
| `no-module-mocking` | `vi.mock` / `jest.mock` |
| `no-object-parameters` | `object` on function inputs |
| `no-reflect-apply` | `Reflect.apply` |
| `no-reflect-get` | `Reflect.get` |
| `no-runtime-typeof` | Ad hoc `typeof` instead of boundary parsing |
| `no-shape-in-symbol-names` | `shape` in symbol names |
| `no-unknown-parameters` | `unknown` parameters except `cause` |
| `no-unknown-returns` | `unknown` / `Promise<unknown>` return contracts |
| `no-unknown-type-aliases` | Aliases that hide `unknown` |
| `no-unsafe-dictionary-type` | Dictionary values of `unknown`, `any`, `object`, `{}`, or unions of those |
| `no-widen-then-assert` | Widen a known value, then assert it back |
| `require-safety-comment-for-type-assertion` | Non-`const` assertions without a nearby `SAFETY:` comment |

`no-runtime-typeof` accepts `{ allowInTypeGuards: true }` so `typeof` may appear
inside type predicates. Default is `false`. This repository enables it.

### Effect

| Rule | Rejects |
| --- | --- |
| `no-service-constructor-imports` | Project-local `make<Capability>` imports outside `*.test.*` / `*.spec.*` |

Import the owning Layer and yield the service. Package imports and static
constructors such as `WorkspaceName.make` are out of scope.

## Attribution

Rule ideas originated in [dmmulroy/anti-slop][upstream]. This package is owned,
published, and maintained by [Victor Software House][vsh].

## License

MIT. Dillon Mulroy's copyright notice is retained. Victor Araújo's is listed
under it. See [LICENSE](./LICENSE).

[vsh]: https://github.com/victor-software-house
[upstream]: https://github.com/dmmulroy/anti-slop
