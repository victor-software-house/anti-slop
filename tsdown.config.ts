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
	dts: { tsconfig: 'tsconfig.build.json' },
	deps: {
		onlyBundle: [],
		onlyImport: ['@oxlint/plugins', 'ts-pattern'],
	},
});
