/**
 * fork: types for vault_struktur.js, the vendored tree-contract library
 * (obsidian-vault-functions/lib/vault_struktur.js — the .js is a byte copy, never edited here).
 * Only what the plugin uses is typed; the library's own README lists the rest.
 */
declare namespace VaultStruktur {
	/** one entry of a folder listing handed to from_config */
	interface DirEntry { name: string; dir: boolean }
	/** `rel` is a vault-relative folder ("" = the vault root); null when it does not exist */
	type ListDir = (rel: string) => DirEntry[] | null;
	/** the parsed `.obsidian/vault-struktur.json` */
	type Config = Record<string, unknown>;

	interface Resolved {
		'område': string | null;
		kontext: string | null;
		projekt: string | null;
		arkiverad: boolean;
		roll: 'hub' | 'notes' | 'analog' | 'inbox' | 'other' | null;
		'kontextnivå': boolean;
	}

	interface Struktur {
		/** where a path sits in the tree: pure path rules, archived included */
		resolve(path: string): Resolved;
		/** folder of a project (or, with projekt null / equal to kontext, of the kontext) */
		folder_of(kontext: string, projekt?: string | null, arkiverad?: boolean | null): string | null;
		/** sorted kontext names; archived ones only when asked for */
		list_kontexts(include_archived?: boolean): string[];
		/** the folder of a kontext: `01_HEM`, `02_PROJEKT/K`, `02_PROJEKT/_archive/K` … */
		kontext_folder(kontext: string, arkiverad?: boolean | null): string;
		/** drops the folder-listing cache */
		refresh(): void;
	}
}

declare const VaultStruktur: {
	from_config(cfg: VaultStruktur.Config, list_dir: VaultStruktur.ListDir): VaultStruktur.Struktur;
	is_caps(token: string): boolean;
};

export = VaultStruktur;
