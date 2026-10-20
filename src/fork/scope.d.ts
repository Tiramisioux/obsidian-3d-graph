/** fork: the pure scope function behind "Open in 3D graph" (see scope.js). */
import type VaultStruktur from './vault_struktur';

export interface ScopeFilter { type: 'path' | 'tag'; value: string; enabled: boolean }

export interface ScopeResult {
	filters: ScopeFilter[];
	/** true: also show the linked neighbours (a plain note) */
	neighbors: boolean;
	/** the note to highlight; null for a folder */
	focusPath: string | null;
}

/**
 * @param projekt the note's `projekt` frontmatter as text ("#X" or "X"); ignored for a folder
 */
export function scopeFilters(path: string, isFolder: boolean, projekt: string | null | undefined, vs: VaultStruktur.Struktur): ScopeResult;
