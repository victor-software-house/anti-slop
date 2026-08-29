import type { UnsafeDictionary, WideningTarget } from '@anti-slop/shared/query';
import { TypeQuery } from '@anti-slop/shared/query';
import { BUILT_INS } from '@anti-slop/shared/transparent-type';
import type { ESTree } from '@oxlint/plugins';
import { match, P } from 'ts-pattern';

export type { UnsafeDictionary, WideningTarget } from '@anti-slop/shared/query';

export class TypeEnvironment {
	readonly aliases: ReadonlyMap<string, ESTree.TSTypeAliasDeclaration>;
	readonly interfaces: ReadonlyMap<string, readonly ESTree.TSInterfaceDeclaration[]>;
	readonly shadowedBuiltIns: ReadonlySet<string>;

	private constructor(
		aliases: ReadonlyMap<string, ESTree.TSTypeAliasDeclaration>,
		interfaces: ReadonlyMap<string, readonly ESTree.TSInterfaceDeclaration[]>,
		shadowedBuiltIns: ReadonlySet<string>,
	) {
		this.aliases = aliases;
		this.interfaces = interfaces;
		this.shadowedBuiltIns = shadowedBuiltIns;
	}

	static empty(): TypeEnvironment {
		return new TypeEnvironment(new Map(), new Map(), new Set());
	}

	static fromProgram(program: ESTree.Program): TypeEnvironment {
		const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();
		const interfaces = new Map<string, ESTree.TSInterfaceDeclaration[]>();
		const shadowedBuiltIns = new Set<string>();

		for (const statement of program.body) {
			recordProgramDeclaration(declaredStatement(statement), aliases, interfaces, shadowedBuiltIns);
		}

		return new TypeEnvironment(aliases, interfaces, shadowedBuiltIns);
	}

	isBuiltIn(name: string): boolean {
		return BUILT_INS.has(name) && !this.shadowedBuiltIns.has(name);
	}

	classifyUnsafeDictionary(type: ESTree.TSType): UnsafeDictionary | null {
		return this.query().classifyUnsafe(type);
	}

	classifyUnsafeDictionaryValue(type: ESTree.TSType): UnsafeDictionary | null {
		return this.query().classifyUnsafeValue(type);
	}

	classifyWideningTarget(type: ESTree.TSType): WideningTarget | null {
		return this.query().classifyWidening(type, 'surface');
	}

	private query(): TypeQuery {
		return new TypeQuery(this, new Map(), new Set());
	}
}

function declaredStatement(statement: ESTree.Statement): ESTree.Node | null {
	return match(statement)
		.with(
			{ type: P.union('ExportNamedDeclaration', 'ExportDefaultDeclaration') },
			({ declaration }) => declaration ?? null,
		)
		.otherwise((value) => value);
}

function shadowIfBuiltIn(name: string, shadowedBuiltIns: Set<string>): void {
	if (BUILT_INS.has(name)) shadowedBuiltIns.add(name);
}

function recordProgramDeclaration(
	declaration: ESTree.Node | null,
	aliases: Map<string, ESTree.TSTypeAliasDeclaration>,
	interfaces: Map<string, ESTree.TSInterfaceDeclaration[]>,
	shadowedBuiltIns: Set<string>,
): void {
	match(declaration)
		.with(P.nullish, () => undefined)
		.with({ type: 'ImportDeclaration' }, ({ specifiers }) => {
			for (const specifier of specifiers) {
				shadowIfBuiltIn(specifier.local.name, shadowedBuiltIns);
			}
		})
		.with({ type: 'TSTypeAliasDeclaration' }, (alias) => {
			match(aliases.get(alias.id.name))
				.with(P.nullish, () => {
					aliases.set(alias.id.name, alias);
				})
				.otherwise(() => {
					shadowedBuiltIns.add(alias.id.name);
				});
			shadowIfBuiltIn(alias.id.name, shadowedBuiltIns);
		})
		.with({ type: 'TSInterfaceDeclaration' }, (iface) => {
			const declarations = interfaces.get(iface.id.name) ?? [];
			declarations.push(iface);
			interfaces.set(iface.id.name, declarations);
			shadowIfBuiltIn(iface.id.name, shadowedBuiltIns);
		})
		.with({ type: 'TSEnumDeclaration' }, (enumDecl) => {
			shadowIfBuiltIn(enumDecl.id.name, shadowedBuiltIns);
		})
		.with(
			{ type: P.union('ClassDeclaration', 'FunctionDeclaration'), id: P.nonNullable },
			({ id }) => {
				shadowIfBuiltIn(id.name, shadowedBuiltIns);
			},
		)
		.otherwise(() => undefined);
}
