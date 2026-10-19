// fork: what "Open in 3D graph" shows for a folder / hub / note, as a pure function on top of the
// vault's tree contract (the vendored vault_struktur.js: `vs.resolve(path)`, `vs.folder_of(...)`).
// No Obsidian API: the plugin passes the path, whether it is a folder, and the note's `projekt`.
//
//   scopeFilters(path, isFolder, projekt, vs) -> { filters, neighbors, focusPath }
//
//   a project folder (<area>/<P>, <area>/_archive/<P>, <02 kontext>/<P>)  -> its path + the tag P
//   a 02 kontext folder (the kontext is itself a project)                  -> its path + the tag K
//   any other folder                                                       -> everything under it
//   a note with `projekt` (bare name, "#" stripped)                        -> that tag, the note highlighted
//   a note inside a project folder (a 02 kontext folder counts)            -> the project folder + the tag, highlighted
//   any other note                                                         -> the note and its linked neighbours
//
// Archived projects and archived 02 kontexts are scoped exactly like active ones.
"use strict";

const nfc = (s) => String(s).normalize("NFC");
const norm = (p) => nfc(p).replace(/^\/+|\/+$/g, "");

// a project folder's notes plus every note tagged with (or naming, via `projekt`) the project
// elsewhere, e.g. clippings; filters are OR-ed
function projectScope(folder, project) {
	return [
		{ type: "path", value: folder, enabled: true },
		{ type: "tag", value: nfc(project), enabled: true },
	];
}

// The folder of the project `r.projekt` that `path` lies in: the contract's folder_of when it is a
// prefix of the path, else the shortest prefix of the path that resolves to that project.
function projectFolder(path, r, vs) {
	const f = vs.folder_of(r.kontext, r.projekt, r.arkiverad);
	if (f && (path === f || path.startsWith(f + "/"))) return f;
	const parts = path.split("/");
	for (let i = 1; i <= parts.length; i++) {
		const prefix = parts.slice(0, i).join("/");
		if (vs.resolve(prefix).projekt === r.projekt) return prefix;
	}
	return null;
}

function scopeFilters(path, isFolder, projekt, vs) {
	const p = norm(path);
	const r = vs.resolve(p);
	if (isFolder) {
		if (r.projekt) {
			const folder = projectFolder(p, r, vs);
			// a project folder, or a 02 kontext folder (kontext = project); not a folder inside one
			if (folder === p) return { filters: projectScope(p + "/", r.projekt), neighbors: false, focusPath: null };
		}
		return { filters: [{ type: "path", value: p + "/", enabled: true }], neighbors: false, focusPath: null };
	}
	const tag = String(projekt == null ? "" : projekt).trim().replace(/^#/, "");
	if (tag) {
		return { filters: [{ type: "tag", value: tag, enabled: true }], neighbors: false, focusPath: p };
	}
	if (r.projekt) {
		const folder = projectFolder(p, r, vs);
		if (folder) return { filters: projectScope(folder + "/", r.projekt), neighbors: false, focusPath: p };
	}
	return { filters: [{ type: "path", value: p, enabled: true }], neighbors: true, focusPath: p };
}

module.exports = { scopeFilters };
