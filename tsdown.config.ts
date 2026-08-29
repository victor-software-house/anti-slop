import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		effect: 'src/effect/index.ts',
	},
	format: 'esm',
	platform: 'neutral',
	target: 'node26',
	sourcemap: true,
	clean: true,
	hash: false,
	unbundle: true,
	dts: true,
	deps: {
		neverBundle: true,
		onlyImport: ['@oxlint/plugins', 'ts-pattern'],
	},
});
