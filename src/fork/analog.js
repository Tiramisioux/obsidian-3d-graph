// fork: pure helpers of the analog view (WP-G) — no Obsidian, no three.js, tested with
// `node tests/analog.test.mjs`.
//   filters      prop matcher (same `key=a|b` semantics as the colour groups), negation, filter lines
//   graph block  the ```3d-graf code block
//   links        frontmatter image values (`bild: "[[x.jpg]]"`)
//   atlas        fixed-cell grid + slot allocator for the thumbnail atlas
//   ordering     nearest-to-camera-first load order, eviction victim
//   picking      ray vs. camera-facing quads
//   lightbox     fit / zoom-around-cursor / pan clamp / previous-next
//   docked       size defaults and clamping of the lower-right preview
"use strict";

// ---- filters ---------------------------------------------------------------

/** `typ=a|b` -> { key (lower case), values (lower case) }; `typ` alone = the key must be set */
function parseProp(body) {
	const s = String(body == null ? "" : body).trim();
	const eq = s.indexOf("=");
	return {
		key: (eq >= 0 ? s.slice(0, eq) : s).trim().toLowerCase(),
		values: eq >= 0 ? s.slice(eq + 1).split("|").map((v) => v.trim().toLowerCase()).filter(Boolean) : [],
	};
}

/** does frontmatter `fm` hold one of `values` under `key` (case-insensitive key; lists count per item)? */
function propMatches(fm, key, values) {
	if (!fm) return false;
	const k = Object.keys(fm).find((x) => x.toLowerCase() === key);
	if (k === undefined) return false;
	const raw = fm[k];
	const items = (Array.isArray(raw) ? raw : [raw]).map((v) => String(v == null ? "" : v).trim().toLowerCase());
	if (!values.length) return items.some((v) => v !== "");
	return items.some((v) => values.includes(v));
}

/** "prop: typ=x" / "!prop: sidtyp=tom" / "tag: X" / "path: Y" (also "!tag:", "!path:") -> filter, or null */
function parseFilterLine(text) {
	const m = /^\s*(!)?\s*(path|tag|prop)\s*:\s*(.*?)\s*$/i.exec(String(text == null ? "" : text));
	if (!m || !m[3]) return null;
	const f = { type: m[2].toLowerCase(), value: m[3], enabled: true };
	if (m[1]) f.negate = true;
	return f;
}

/** the other direction, for the settings tab and docs */
function formatFilter(f) {
	return (f.negate ? "!" : "") + f.type + ": " + f.value;
}

/**
 * The verdict of a list of filters. Positive filters are OR-ed (as before: a node must match
 * one of them), negated filters exclude (AND NOT) — `prop: typ=analog anteckning` plus
 * `!prop: sidtyp=tom` = analog notes except empty pages. Only negated filters = everything
 * except those. Disabled / empty filters are ignored; none active = null (no filtering).
 * @returns {((node: any) => boolean) | null}
 */
function filterPredicate(filters, matchOne) {
	const active = filters.filter((f) => f.enabled && String(f.value).trim() !== "");
	if (!active.length) return null;
	const pos = active.filter((f) => !f.negate), neg = active.filter((f) => f.negate);
	return (node) => {
		if (pos.length && !pos.some((f) => matchOne(node, f))) return false;
		return !neg.some((f) => matchOne(node, f));
	};
}

// ---- the ```3d-graf block -------------------------------------------------------

/** på/on/ja/true -> true, av/off/nej/false -> false, else null */
function parseSwitch(v) {
	const s = String(v == null ? "" : v).trim().toLowerCase();
	if (["på", "pa", "on", "ja", "yes", "true", "1"].includes(s)) return true;
	if (["av", "off", "nej", "no", "false", "0"].includes(s)) return false;
	return null;
}

/**
 * lines: `filter: <filter line>` (repeatable), `tidslinje: på`, `miniatyrer: på`,
 * `grannar: på|av` (default på), `taggar: på|av` (default: leave the user's setting), `knapp: <label>`. Unknown lines go to `errors`.
 */
function parseGraphBlock(source) {
	const out = { filters: [], timeline: false, thumbnails: false, neighbors: true, tags: null, label: "Visa i 3D", errors: [] };
	for (const raw of String(source == null ? "" : source).split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const m = /^([^:]+):\s*(.*)$/.exec(line);
		if (!m) { out.errors.push(line); continue; }
		const key = m[1].trim().toLowerCase(), val = m[2].trim();
		if (key === "filter") {
			const f = parseFilterLine(val);
			if (f) out.filters.push(f); else out.errors.push(line);
		} else if (key === "tidslinje" || key === "miniatyrer" || key === "grannar" || key === "taggar") {
			const b = parseSwitch(val);
			if (b === null) { out.errors.push(line); continue; }
			if (key === "tidslinje") out.timeline = b;
			else if (key === "miniatyrer") out.thumbnails = b;
			else if (key === "taggar") out.tags = b;
			else out.neighbors = b;
		} else if (key === "knapp") {
			if (val) out.label = val;
		} else out.errors.push(line);
	}
	return out;
}

// ---- image links in frontmatter -----------------------------------------------

const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"];

/** `[[a/b.jpg|alias]]`, `![[a/b.jpg#x]]` or a plain path -> the link path; "" when empty */
function linkpathOf(value) {
	let s = String(value == null ? "" : value).trim();
	const m = /^!?\[\[(.*?)\]\]$/.exec(s);
	if (m) s = m[1];
	return s.split("|")[0].split("#")[0].trim();
}

function isImagePath(p) {
	const m = /\.([a-z0-9]+)$/i.exec(String(p));
	return !!m && IMAGE_EXT.includes(m[1].toLowerCase());
}

/** the link paths in frontmatter under the first of `keys` that is present (case-insensitive), in order */
function imageLinkCandidates(fm, keys) {
	if (!fm) return [];
	const out = [];
	for (const key of keys) {
		const k = Object.keys(fm).find((x) => x.toLowerCase() === String(key).trim().toLowerCase());
		if (k === undefined) continue;
		for (const v of Array.isArray(fm[k]) ? fm[k] : [fm[k]]) {
			const p = linkpathOf(v);
			if (p) out.push(p);
		}
	}
	return out;
}

/** `[[... Anteckningsbok A4 hub]]` -> "... Anteckningsbok A4" */
function collectionName(samling) {
	return linkpathOf(samling).split("/").pop().replace(/\.md$/i, "").replace(/\s+hub$/i, "");
}

// ---- atlas -------------------------------------------------------------------

/** cells of a page: fixed size, so a slot can be reused by any thumbnail */
function atlasGrid(pageSize, cellW, cellH) {
	const cols = Math.floor(pageSize / cellW), rows = Math.floor(pageSize / cellH);
	return { pageSize, cellW, cellH, cols, rows, perPage: cols * rows };
}

/** slot number -> { page, x, y } (pixels, top-down) */
function slotRect(slot, grid) {
	const page = Math.floor(slot / grid.perPage), i = slot % grid.perPage;
	return { page, x: (i % grid.cols) * grid.cellW, y: Math.floor(i / grid.cols) * grid.cellH };
}

/** the size an image gets in a cell: height cellH if it fits the width, else scaled down */
function fitCell(w, h, cellW, cellH) {
	if (!(w > 0) || !(h > 0)) return { w: cellW, h: cellH };
	const s = Math.min(cellH / h, cellW / w);
	return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** hands out slot numbers 0..maxSlots-1, reusing freed ones first; null when full */
class SlotAllocator {
	constructor(maxSlots) {
		this.maxSlots = maxSlots;
		this.next = 0;
		this.freed = [];
	}
	alloc() {
		if (this.freed.length) return this.freed.pop();
		return this.next < this.maxSlots ? this.next++ : null;
	}
	free(slot) { this.freed.push(slot); }
	/** an allocator in which exactly the slots of `used` are taken (kept across a rebuild) */
	static fromUsed(maxSlots, used) {
		const a = new SlotAllocator(maxSlots);
		const set = new Set(used.filter((u) => u >= 0 && u < maxSlots));
		let top = 0;
		for (const u of set) if (u + 1 > top) top = u + 1;
		a.next = top;
		for (let i = top - 1; i >= 0; i--) if (!set.has(i)) a.freed.push(i);
		return a;
	}
	get used() { return this.next - this.freed.length; }
	get pagesTouched() { return this.next; }
}

// ---- load order -------------------------------------------------------------------

const OUTSIDE = 1e12; // added to the squared distance of a thumbnail outside the view

/**
 * Priority key per thumbnail: squared distance to the camera, +OUTSIDE when outside the frustum
 * (so everything in view loads before anything off screen). pos = x,y,z triples.
 * @param {Float32Array} pos @param {{x:number,y:number,z:number}} cam
 * @param {(x:number,y:number,z:number)=>boolean} inView
 */
function priorityKeys(pos, count, cam, inView, out) {
	const keys = out && out.length >= count ? out : new Float64Array(count);
	for (let i = 0; i < count; i++) {
		const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
		const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
		keys[i] = dx * dx + dy * dy + dz * dz + (inView(x, y, z) ? 0 : OUTSIDE);
	}
	return keys;
}

/** thumbnail indices sorted nearest first (ties by index, so the order is stable) */
function loadOrder(keys, count) {
	const idx = new Array(count);
	for (let i = 0; i < count; i++) idx[i] = i;
	idx.sort((a, b) => keys[a] - keys[b] || a - b);
	return idx;
}

/** the loaded thumbnail to give its slot up for a requester with `requesterKey`: the farthest one,
 *  only if it is farther than the requester; -1 when none */
function evictionVictim(keys, loaded, requesterKey) {
	let best = -1, bestKey = requesterKey;
	for (const i of loaded) {
		if (keys[i] > bestKey) { best = i; bestKey = keys[i]; }
	}
	return best;
}

// ---- timeline lanes for thumbnails -------------------------------------------------

/**
 * Deterministic sideways layout of cards on a timeline. Collections run side by side in lanes
 * (interval scheduling over each collection's first..last day: the lowest lane free over its whole
 * span, so parallel notebooks run in parallel and one notebook stays in one lane); the pages of one
 * collection on one day form a small grid of `cols` columns (rows run along the time axis).
 * rows: [{ key, day (ms), order }]. Returns per row { across, along } in world units:
 * `across` = position across the time axis, `along` = offset added to the date's position.
 */
function thumbLanes(rows, opts) {
	const cols = Math.max(1, opts.cols | 0), cw = opts.cellW + opts.gap, ch = opts.cellH + opts.gap;
	const colls = new Map();
	rows.forEach((r, i) => {
		let c = colls.get(r.key);
		if (!c) colls.set(r.key, (c = { key: r.key, first: r.day, last: r.day, idx: [], lane: 0 }));
		c.first = Math.min(c.first, r.day);
		c.last = Math.max(c.last, r.day);
		c.idx.push(i);
	});
	const list = [...colls.values()].sort((a, b) => a.first - b.first || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
	const laneEnd = [];
	for (const c of list) {
		let l = laneEnd.findIndex((end) => end < c.first);
		if (l < 0) { l = laneEnd.length; laneEnd.push(c.last); } else laneEnd[l] = c.last;
		c.lane = l;
	}
	const laneW = cols * cw + cw; // a gap column between lanes
	const across = new Float64Array(rows.length), along = new Float64Array(rows.length);
	const centre = (laneEnd.length - 1) / 2;
	for (const c of list) {
		const byDay = new Map();
		for (const i of c.idx) {
			const a = byDay.get(rows[i].day);
			if (a) a.push(i); else byDay.set(rows[i].day, [i]);
		}
		for (const idx of byDay.values()) {
			idx.sort((a, b) => rows[a].order - rows[b].order || a - b);
			idx.forEach((i, k) => {
				across[i] = (c.lane - centre) * laneW + ((k % cols) - (cols - 1) / 2) * cw;
				along[i] = Math.floor(k / cols) * ch;
			});
		}
	}
	const centres = new Map();
	for (const c of list) centres.set(c.key, (c.lane - centre) * laneW);
	return { across, along, lanes: laneEnd.length, laneWidth: laneW, centres };
}

// ---- picking -------------------------------------------------------------------

/**
 * Nearest camera-facing quad under a ray. centres = x,y,z triples, size = w,h pairs (world units).
 * fwd/right/up = the camera's axes. Returns the index or -1.
 */
function pickQuad(origin, dir, fwd, right, up, centres, size, count) {
	const denom = dir.x * fwd.x + dir.y * fwd.y + dir.z * fwd.z;
	if (Math.abs(denom) < 1e-6) return -1;
	let best = -1, bestT = Infinity;
	for (let i = 0; i < count; i++) {
		const cx = centres[i * 3], cy = centres[i * 3 + 1], cz = centres[i * 3 + 2];
		const t = ((cx - origin.x) * fwd.x + (cy - origin.y) * fwd.y + (cz - origin.z) * fwd.z) / denom;
		if (t <= 0 || t >= bestT) continue;
		const px = origin.x + dir.x * t - cx, py = origin.y + dir.y * t - cy, pz = origin.z + dir.z * t - cz;
		if (Math.abs(px * right.x + py * right.y + pz * right.z) <= size[i * 2] / 2 &&
			Math.abs(px * up.x + py * up.y + pz * up.z) <= size[i * 2 + 1] / 2) { best = i; bestT = t; }
	}
	return best;
}

// ---- lightbox -------------------------------------------------------------------

/** scale that fits an image into the view with `margin` (0–1) of it used */
function fitScale(iw, ih, vw, vh, margin = 0.94) {
	if (!(iw > 0) || !(ih > 0) || !(vw > 0) || !(vh > 0)) return 1;
	return Math.min(vw / iw, vh / ih) * margin;
}

/** the state { s, x, y } (CSS translate(x,y) scale(s), origin top-left) that centres the fitted image */
function fitState(iw, ih, vw, vh, margin) {
	const s = fitScale(iw, ih, vw, vh, margin);
	return { s, x: (vw - iw * s) / 2, y: (vh - ih * s) / 2 };
}

/** keep the image from being dragged out of the view: smaller than the view -> centred */
function clampPan(st, iw, ih, vw, vh) {
	const w = iw * st.s, h = ih * st.s;
	const x = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, st.x));
	const y = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, st.y));
	return { s: st.s, x, y };
}

/** zoom by `factor` keeping the image point under (cx, cy) still; scale limited to [fit·minRel, fit·maxRel] */
function zoomAt(st, factor, cx, cy, fit, minRel = 1, maxRel = 8) {
	const s = Math.min(fit * maxRel, Math.max(fit * minRel, st.s * factor));
	const k = s / st.s;
	return { s, x: cx - (cx - st.x) * k, y: cy - (cy - st.y) * k };
}

/** the id `delta` steps from `current` in `ids` (no wrap); `current` not in the list -> the first/last */
function neighbourId(ids, current, delta) {
	if (!ids.length) return null;
	const i = ids.indexOf(current);
	if (i < 0) return delta >= 0 ? ids[0] : ids[ids.length - 1];
	const j = i + delta;
	return j < 0 || j >= ids.length ? null : ids[j];
}

// ---- docked preview -------------------------------------------------------------------

const DOCK_DEFAULT = { w: 500, h: 680 };
const DOCK_MIN = { w: 240, h: 220 };
const DOCK_MAX_FRAC = { w: 0.45, h: 0.8 }; // of the graph view

/** size limited to [min, share of the view]; `reservedTop` px at the top (the switch panel and a gap) and
 *  10 px at the bottom are not available to the panel; a view smaller than the minimum wins over the minimum */
function clampDockSize(w, h, viewW, viewH, reservedTop = 0) {
	const maxW = Math.max(1, Math.floor(viewW * DOCK_MAX_FRAC.w));
	const maxH = Math.max(1, Math.min(Math.floor(viewH * DOCK_MAX_FRAC.h), Math.floor(viewH - reservedTop - 10)));
	const cl = (v, lo, hi) => Math.round(Math.min(hi, Math.max(Math.min(lo, hi), Number.isFinite(v) ? v : lo)));
	return { w: cl(w, DOCK_MIN.w, maxW), h: cl(h, DOCK_MIN.h, maxH) };
}

/** corner handle at the panel's upper left (the panel is anchored lower right): dragging left/up grows it */
function dockSizeFromDrag(start, dx, dy, viewW, viewH, reservedTop = 0) {
	return clampDockSize(start.w - dx, start.h - dy, viewW, viewH, reservedTop);
}

module.exports = {
	parseProp, propMatches, parseFilterLine, formatFilter, filterPredicate,
	parseSwitch, parseGraphBlock,
	IMAGE_EXT, linkpathOf, isImagePath, imageLinkCandidates, collectionName,
	atlasGrid, slotRect, fitCell, SlotAllocator,
	OUTSIDE, priorityKeys, loadOrder, evictionVictim,
	thumbLanes,
	pickQuad,
	fitScale, fitState, clampPan, zoomAt, neighbourId,
	DOCK_DEFAULT, DOCK_MIN, DOCK_MAX_FRAC, clampDockSize, dockSizeFromDrag,
};
