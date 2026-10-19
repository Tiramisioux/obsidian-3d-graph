// fork: tests of the pure "Open in 3D graph" scope (src/fork/scope.js) on the vault's tree contract.
// Run: node tests/scope.test.mjs   (plain node, no build; prints `cases: N`, exit 1 on a failure)
import assert from "node:assert/strict";
import VaultStruktur from "../src/fork/vault_struktur.js";
import scope from "../src/fork/scope.js";

const { scopeFilters } = scope;

const CONTRACT = {
	version: 1,
	"områden": [{ mapp: "01_HEM", kontext: "HEM" }, { mapp: "02_PROJEKT", kontext: null }, { mapp: "03_RISE", kontext: "RISE" }],
	arkiv: "_archive", anteckningar: "notes", analog: "analog", analogrot: "_analoga anteckningar",
	mallar: "_templates", hubmall: "_templates/projekt_task_template.md", inkorg: "_inbox.md",
	otaggat: "04_INBOX", standardkontext: "RISE",
};
const TREE = [
	"01_HEM/_inbox.md", "01_HEM/BOKLÅN/20260101000000 HEM BOKLÅN hub.md", "01_HEM/BOKLÅN/notes/n.md",
	"01_HEM/_archive/GAMMALT/notes/old.md",
	"03_RISE/_inbox.md", "03_RISE/notes/loose.md", "03_RISE/UND/20260101000001 RISE UND hub.md", "03_RISE/UND/notes/a.md",
	"03_RISE/_archive/GAMLA/20250101000000 RISE GAMLA hub.md", "03_RISE/_archive/GAMLA/notes/x.md",
	"02_PROJEKT/NORDKAPAREN/20260624000000 NORDKAPAREN hub.md", "02_PROJEKT/NORDKAPAREN/_inbox.md", "02_PROJEKT/NORDKAPAREN/notes/n.md",
	"02_PROJEKT/NORDKAPAREN/DOK/20260624000001 NORDKAPAREN DOK hub.md", "02_PROJEKT/NORDKAPAREN/DOK/notes/n.md",
	"02_PROJEKT/NORDKAPAREN/_archive/FORSTUDIE/notes/n.md",
	"02_PROJEKT/_archive/GÄDDKUNGEN/20260101000002 GÄDDKUNGEN hub.md", "02_PROJEKT/_archive/GÄDDKUNGEN/notes/x.md",
	"02_PROJEKT/_archive/GÄDDKUNGEN/SLUTET/notes/y.md",
	"04_INBOX/lös.md",
];

function makeStruktur(cfg, tree) {
	const kids = new Map([["", new Map()]]);
	for (const e of tree) {
		const parts = e.replace(/\/+$/, "").split("/");
		let cur = "";
		parts.forEach((part, i) => {
			const next = cur ? cur + "/" + part : part;
			const dir = i < parts.length - 1 || e.endsWith("/");
			if (!kids.has(cur)) kids.set(cur, new Map());
			kids.get(cur).set(part, dir);
			if (dir && !kids.has(next)) kids.set(next, new Map());
			cur = next;
		});
	}
	return VaultStruktur.from_config(cfg, (rel) => {
		const k = kids.get(rel);
		return k ? [...k.entries()].map(([name, dir]) => ({ name, dir })) : null;
	});
}

const vs = makeStruktur(CONTRACT, TREE);
const P = (v) => ({ type: "path", value: v, enabled: true });
const T = (v) => ({ type: "tag", value: v, enabled: true });
const projectOf = (folder, tag, focus) => ({ filters: [P(folder + "/"), T(tag)], neighbors: false, focusPath: focus });

// [name, [path, isFolder, projekt], expected]
const CASES = [
	["project folder of a fixed kontext: path + tag", ["03_RISE/UND", true, ""], projectOf("03_RISE/UND", "UND", null)],
	["a folder inside a project is a plain path filter", ["03_RISE/UND/notes", true, ""], { filters: [P("03_RISE/UND/notes/")], neighbors: false, focusPath: null }],
	["archived project folder: path + tag", ["03_RISE/_archive/GAMLA", true, ""], projectOf("03_RISE/_archive/GAMLA", "GAMLA", null)],
	["archived project in HEM", ["01_HEM/_archive/GAMMALT", true, ""], projectOf("01_HEM/_archive/GAMMALT", "GAMMALT", null)],
	["02 kontext folder counts as a project for its kontext tag", ["02_PROJEKT/NORDKAPAREN", true, ""], projectOf("02_PROJEKT/NORDKAPAREN", "NORDKAPAREN", null)],
	["project folder inside a 02 kontext", ["02_PROJEKT/NORDKAPAREN/DOK", true, ""], projectOf("02_PROJEKT/NORDKAPAREN/DOK", "DOK", null)],
	["archived project inside a 02 kontext", ["02_PROJEKT/NORDKAPAREN/_archive/FORSTUDIE", true, ""], projectOf("02_PROJEKT/NORDKAPAREN/_archive/FORSTUDIE", "FORSTUDIE", null)],
	["archived whole 02 kontext folder", ["02_PROJEKT/_archive/GÄDDKUNGEN", true, ""], projectOf("02_PROJEKT/_archive/GÄDDKUNGEN", "GÄDDKUNGEN", null)],
	["project folder inside an archived 02 kontext", ["02_PROJEKT/_archive/GÄDDKUNGEN/SLUTET", true, ""], projectOf("02_PROJEKT/_archive/GÄDDKUNGEN/SLUTET", "SLUTET", null)],
	["the kontext folder of a fixed kontext is a plain path filter", ["03_RISE", true, ""], { filters: [P("03_RISE/")], neighbors: false, focusPath: null }],
	["the open area folder and the archive folder are plain path filters", ["02_PROJEKT", true, ""], { filters: [P("02_PROJEKT/")], neighbors: false, focusPath: null }],
	["a trailing slash and NFD letters give the same NFC filters", ["01_HEM/BOKLÅN/".normalize("NFD"), true, ""], projectOf("01_HEM/BOKLÅN", "BOKLÅN", null)],
	["a note with projekt: the project's tag, the note highlighted", ["Clippings/klipp.md", false, '#DOK'], { filters: [T("DOK")], neighbors: false, focusPath: "Clippings/klipp.md" }],
	["projekt wins over the folder the note sits in", ["03_RISE/UND/notes/a.md", false, "#ANNAT"], { filters: [T("ANNAT")], neighbors: false, focusPath: "03_RISE/UND/notes/a.md" }],
	["a note in a project folder without projekt", ["03_RISE/UND/notes/a.md", false, ""], projectOf("03_RISE/UND", "UND", "03_RISE/UND/notes/a.md")],
	["a hub in its project folder", ["03_RISE/UND/20260101000001 RISE UND hub.md", false, ""], projectOf("03_RISE/UND", "UND", "03_RISE/UND/20260101000001 RISE UND hub.md")],
	["a note in an archived project", ["03_RISE/_archive/GAMLA/notes/x.md", false, ""], projectOf("03_RISE/_archive/GAMLA", "GAMLA", "03_RISE/_archive/GAMLA/notes/x.md")],
	["a note at the level of a 02 kontext", ["02_PROJEKT/NORDKAPAREN/notes/n.md", false, ""], projectOf("02_PROJEKT/NORDKAPAREN", "NORDKAPAREN", "02_PROJEKT/NORDKAPAREN/notes/n.md")],
	["a note in a project of a 02 kontext", ["02_PROJEKT/NORDKAPAREN/DOK/notes/n.md", false, ""], projectOf("02_PROJEKT/NORDKAPAREN/DOK", "DOK", "02_PROJEKT/NORDKAPAREN/DOK/notes/n.md")],
	["a note in an archived project of a 02 kontext", ["02_PROJEKT/NORDKAPAREN/_archive/FORSTUDIE/notes/n.md", false, ""], projectOf("02_PROJEKT/NORDKAPAREN/_archive/FORSTUDIE", "FORSTUDIE", "02_PROJEKT/NORDKAPAREN/_archive/FORSTUDIE/notes/n.md")],
	["a note in an archived 02 kontext", ["02_PROJEKT/_archive/GÄDDKUNGEN/notes/x.md", false, ""], projectOf("02_PROJEKT/_archive/GÄDDKUNGEN", "GÄDDKUNGEN", "02_PROJEKT/_archive/GÄDDKUNGEN/notes/x.md")],
	["a kontext-level note of a fixed kontext has no project: the note and its neighbours", ["03_RISE/notes/loose.md", false, ""], { filters: [P("03_RISE/notes/loose.md")], neighbors: true, focusPath: "03_RISE/notes/loose.md" }],
	["a note outside every area: the note and its neighbours", ["04_INBOX/lös.md", false, ""], { filters: [P("04_INBOX/lös.md")], neighbors: true, focusPath: "04_INBOX/lös.md" }],
	["a missing projekt (undefined / null) behaves like an empty one", ["04_INBOX/lös.md", false, undefined], { filters: [P("04_INBOX/lös.md")], neighbors: true, focusPath: "04_INBOX/lös.md" }],
];

let failures = 0;
for (const [name, args, want] of CASES) {
	try {
		assert.deepEqual(scopeFilters(args[0], args[1], args[2], vs), want);
	} catch (e) {
		failures += 1;
		console.error("FAIL " + name + "\n  " + String(e.message).split("\n").join("\n  "));
	}
}

// the old behaviour (regex on 03_PROJEKTPLANERING) knew none of these: guard the archived and 02 shapes explicitly
const archived = CASES.filter(([n]) => /archived|02 kontext|02 project/.test(n)).length;
try {
	assert.ok(CASES.length >= 10 && archived >= 5, "need >= 10 cases incl. archived and 02 shapes");
} catch (e) {
	failures += 1;
	console.error("FAIL " + e.message);
}
console.log("cases: " + CASES.length + " (archived/02 shapes: " + archived + ")");
process.exit(failures ? 1 : 0);
