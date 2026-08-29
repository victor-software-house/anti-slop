import { noServiceConstructorImportsRule } from '@anti-slop/effect/rules/no-service-constructor-imports';
import type { Plugin } from '@oxlint/plugins';
import { eslintCompatPlugin } from '@oxlint/plugins';

/** Opt-in Oxlint rules for Effect service and Layer architecture. */
const antiSlopEffectPlugin: Plugin = eslintCompatPlugin({
	meta: { name: 'anti-slop-effect' },
	rules: {
		'no-service-constructor-imports': noServiceConstructorImportsRule,
	},
});

export default antiSlopEffectPlugin;
