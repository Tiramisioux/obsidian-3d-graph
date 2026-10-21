// fork: tests of the pure helpers of the analog view (src/fork/analog.js).
// Run: node tests/analog.test.mjs   (plain node, no build; prints `cases: N`, exit 1 on a failure)
import assert from "node:assert/strict";
import A from "../src/fork/analog.js";

let n = 0;
const t = (name, fn) => { fn(); n++; };

// ---- prop filter ----
t("parseProp", () => {
	assert.deepEqual(A.parseProp("Typ=Analog Anteckning"), { key: "typ", values: ["analog anteckning"] });
	assert.deepEqual(A.parseProp("typ=email|Mail"), { key: "typ", values: ["email", "mail"] });
	assert.deepEqual(A.parseProp("status"), { key: "status", values: [] });
});
t("propMatches", () => {
	const fm = { Typ: "analog anteckning", fas: ["#A", "#B"], tom: "", n: 3 };
	assert.ok(A.propMatches(fm, "typ", ["analog anteckning"]));
	assert.ok(!A.propMatches(fm, "typ", ["hub"]));
	assert.ok(A.propMatches(fm, "fas", ["#b"]));
	assert.ok(A.propMatches(fm, "typ", []));
	assert.ok(!A.propMatches(fm, "tom", []));
	assert.ok(A.propMatches(fm, "n", ["3"]));
	assert.ok(!A.propMatches(fm, "saknas", []));
	assert.ok(!A.propMatches(undefined, "typ", []));
});
t("parseFilterLine", () => {
	assert.deepEqual(A.parseFilterLine("prop: typ=analog anteckning"), { type: "prop", value: "typ=analog anteckning", enabled: true });
	assert.deepEqual(A.parseFilterLine("!prop: sidtyp=tom"), { type: "prop", value: "sidtyp=tom", enabled: true, negate: true });
	assert.deepEqual(A.parseFilterLine("  ! tag : STOPP "), { type: "tag", value: "STOPP", enabled: true, negate: true });
	assert.equal(A.parseFilterLine("foo"), null);
	assert.equal(A.parseFilterLine("prop:"), null);
	assert.equal(A.formatFilter(A.parseFilterLine("!prop: a=b")), "!prop: a=b");
});
t("filterPredicate: OR of positives, negatives exclude", () => {
	const nodes = [
		{ id: "a", fm: { typ: "analog anteckning", sidtyp: "innehåll" } },
		{ id: "b", fm: { typ: "analog anteckning", sidtyp: "tom" } },
		{ id: "c", fm: { typ: "hub" } },
		{ id: "d", fm: {} },
	];
	const match = (node, f) => {
		const p = A.parseProp(f.value);
		return A.propMatches(node.fm, p.key, p.values);
	};
	const ids = (filters) => {
		const pred = A.filterPredicate(filters, match);
		return pred ? nodes.filter(pred).map((x) => x.id) : null;
	};
	assert.deepEqual(ids([A.parseFilterLine("prop: typ=analog anteckning"), A.parseFilterLine("!prop: sidtyp=tom")]), ["a"]);
	assert.deepEqual(ids([A.parseFilterLine("prop: typ=analog anteckning|hub")]), ["a", "b", "c"]);
	assert.deepEqual(ids([A.parseFilterLine("prop: typ=hub"), A.parseFilterLine("prop: sidtyp=tom")]), ["b", "c"]);
	assert.deepEqual(ids([A.parseFilterLine("!prop: sidtyp=tom")]), ["a", "c", "d"]);
	assert.equal(ids([]), null);
	assert.equal(ids([{ type: "prop", value: "  ", enabled: true }, { type: "prop", value: "typ=hub", enabled: false }]), null);
});

// ---- code block ----
t("parseGraphBlock", () => {
	const b = A.parseGraphBlock("filter: prop: typ=analog anteckning\nfilter: !prop: sidtyp=tom\ntidslinje: på\nminiatyrer: på\nknapp: Visa analoga\n");
	assert.equal(b.filters.length, 2);
	assert.equal(b.filters[1].negate, true);
	assert.ok(b.timeline && b.thumbnails && b.neighbors);
	assert.equal(b.label, "Visa analoga");
	assert.deepEqual(b.errors, []);
	const c = A.parseGraphBlock("filter: tag: X\ngrannar: av\nkonstigt\nfilter: oväntat\ntidslinje: kanske");
	assert.equal(c.neighbors, false);
	assert.equal(c.label, "Visa i 3D");
	assert.equal(c.errors.length, 3);
	assert.equal(A.parseSwitch("Av"), false);
	assert.equal(A.parseSwitch("PÅ"), true);
});

// ---- links ----
t("links", () => {
	assert.equal(A.linkpathOf("[[_analoga anteckningar/x/a.jpg]]"), "_analoga anteckningar/x/a.jpg");
	assert.equal(A.linkpathOf("![[a.jpg|alias]]"), "a.jpg");
	assert.equal(A.linkpathOf("a/b.png#x"), "a/b.png");
	assert.equal(A.linkpathOf(null), "");
	assert.ok(A.isImagePath("a/B.JPG") && !A.isImagePath("a.md"));
	assert.deepEqual(A.imageLinkCandidates({ Bild: "[[a.jpg]]", andra: ["[[b.png]]"] }, ["bild", "andra"]), ["a.jpg", "b.png"]);
	assert.deepEqual(A.imageLinkCandidates({}, ["bild"]), []);
	assert.equal(A.collectionName("[[2022-02-06–2022-06-02 Kollegieblock A4 hub]]"), "2022-02-06–2022-06-02 Kollegieblock A4");
});

// ---- atlas ----
t("atlas grid + slots", () => {
	const g = A.atlasGrid(2048, 68, 88);
	assert.equal(g.cols, 30); assert.equal(g.rows, 23); assert.equal(g.perPage, 690);
	assert.deepEqual(A.slotRect(0, g), { page: 0, x: 0, y: 0 });
	assert.deepEqual(A.slotRect(31, g), { page: 0, x: 68, y: 88 });
	assert.deepEqual(A.slotRect(690, g), { page: 1, x: 0, y: 0 });
	// every slot of 7 pages is distinct and inside its page
	const seen = new Set();
	for (let s = 0; s < 7 * g.perPage; s++) {
		const r = A.slotRect(s, g);
		assert.ok(r.x + g.cellW <= 2048 && r.y + g.cellH <= 2048 && r.page < 7);
		seen.add(r.page + ":" + r.x + ":" + r.y);
	}
	assert.equal(seen.size, 7 * g.perPage);
	assert.ok(7 * g.perPage >= 4325, "7 pages hold the 4 325 scans");
	assert.deepEqual(A.fitCell(1559, 2083, 68, 88), { w: 66, h: 88 });
	assert.deepEqual(A.fitCell(2083, 1559, 68, 88), { w: 68, h: 51 });
	assert.deepEqual(A.fitCell(0, 0, 68, 88), { w: 68, h: 88 });
	const al = new A.SlotAllocator(3);
	assert.deepEqual([al.alloc(), al.alloc(), al.alloc(), al.alloc()], [0, 1, 2, null]);
	al.free(1);
	assert.equal(al.used, 2);
	assert.equal(al.alloc(), 1);
	assert.equal(al.alloc(), null);
});

t("SlotAllocator.fromUsed keeps taken slots, frees the holes", () => {
	const a = A.SlotAllocator.fromUsed(6, [0, 3, 9]);
	assert.equal(a.used, 2);
	assert.deepEqual([a.alloc(), a.alloc(), a.alloc(), a.alloc(), a.alloc()], [1, 2, 4, 5, null]);
});

// ---- ordering ----
t("load order: nearest first, in view before off screen, stable", () => {
	const pos = new Float32Array([0, 0, 10, 0, 0, 3, 50, 0, 0, 0, 0, 3, 5, 0, 0]);
	const inView = (x) => x < 10;
	const keys = A.priorityKeys(pos, 5, { x: 0, y: 0, z: 0 }, inView);
	assert.deepEqual(A.loadOrder(keys, 5), [1, 3, 4, 0, 2]); // 1 and 3 tie -> index order; 2 is off screen
	const victim = A.evictionVictim(keys, [0, 1, 4], keys[3]);
	assert.equal(victim, 0);
	assert.equal(A.evictionVictim(keys, [1, 3], keys[4]), -1); // nothing farther than the requester
});
t("load order on 4 325 thumbnails is fast", () => {
	const N = 4325, pos = new Float32Array(N * 3);
	for (let i = 0; i < pos.length; i++) pos[i] = Math.sin(i * 12.9898) * 500;
	const t0 = performance.now();
	const keys = A.priorityKeys(pos, N, { x: 0, y: 0, z: 800 }, (x, y) => Math.abs(x) < 300 && Math.abs(y) < 200);
	const ord = A.loadOrder(keys, N);
	const ms = performance.now() - t0;
	assert.equal(ord.length, N);
	for (let i = 1; i < N; i++) assert.ok(keys[ord[i - 1]] <= keys[ord[i]]);
	console.log(`  (priority + sort of ${N}: ${ms.toFixed(1)} ms)`);
});

// ---- picking ----
t("pickQuad", () => {
	const o = { x: 0, y: 0, z: 100 }, d = { x: 0, y: 0, z: -1 };
	const fwd = { x: 0, y: 0, z: -1 }, right = { x: 1, y: 0, z: 0 }, up = { x: 0, y: 1, z: 0 };
	const c = new Float32Array([0, 0, 0, 0, 0, 50, 30, 0, 0]);
	const sz = new Float32Array([10, 14, 10, 14, 10, 14]);
	assert.equal(A.pickQuad(o, d, fwd, right, up, c, sz, 3), 1); // the nearer quad wins
	assert.equal(A.pickQuad({ x: 6, y: 0, z: 100 }, d, fwd, right, up, c, sz, 3), -1); // beside (half width 5)
	assert.equal(A.pickQuad({ x: 4.9, y: 6.9, z: 100 }, d, fwd, right, up, c, sz, 3), 1);
	assert.equal(A.pickQuad({ x: 4.9, y: 7.1, z: 100 }, d, fwd, right, up, c, sz, 3), -1);
	assert.equal(A.pickQuad({ x: 30, y: 0, z: 100 }, d, fwd, right, up, c, sz, 3), 2);
	assert.equal(A.pickQuad({ x: 0, y: 0, z: -10 }, d, fwd, right, up, c, sz, 3), -1); // behind the ray start
});

// ---- lightbox ----
t("lightbox maths", () => {
	const st = A.fitState(1559, 2083, 1000, 800, 1);
	assert.ok(Math.abs(st.s - 800 / 2083) < 1e-9);
	assert.ok(Math.abs(st.x - (1000 - 1559 * st.s) / 2) < 1e-9 && st.y === 0);
	const fit = st.s;
	// the image point under the cursor stays under the cursor
	const cx = 300, cy = 200;
	const px = (cx - st.x) / st.s, py = (cy - st.y) / st.s;
	const z = A.zoomAt(st, 2, cx, cy, fit);
	assert.ok(Math.abs(z.x + px * z.s - cx) < 1e-9 && Math.abs(z.y + py * z.s - cy) < 1e-9);
	assert.ok(Math.abs(z.s - 2 * fit) < 1e-12);
	// limits: not below fit, not above 8× fit
	assert.equal(A.zoomAt(st, 0.1, cx, cy, fit).s, fit);
	assert.equal(A.zoomAt(z, 1000, cx, cy, fit).s, fit * 8);
	// pan clamp: zoomed in, can't leave the view; fitted, stays centred
	const big = { s: fit * 4, x: 500, y: 500 };
	const c1 = A.clampPan(big, 1559, 2083, 1000, 800);
	assert.equal(c1.x, 0); assert.equal(c1.y, 0);
	const c2 = A.clampPan({ s: fit * 4, x: -99999, y: -99999 }, 1559, 2083, 1000, 800);
	assert.ok(Math.abs(c2.x - (1000 - 1559 * fit * 4)) < 1e-9 && Math.abs(c2.y - (800 - 2083 * fit * 4)) < 1e-9);
	const c3 = A.clampPan({ s: fit, x: 123, y: 77 }, 1559, 2083, 1000, 800);
	assert.ok(Math.abs(c3.x - st.x) < 1e-9 && Math.abs(c3.y - st.y) < 1e-9);
	assert.equal(A.neighbourId(["a", "b", "c"], "b", 1), "c");
	assert.equal(A.neighbourId(["a", "b", "c"], "c", 1), null);
	assert.equal(A.neighbourId(["a", "b", "c"], "a", -1), null);
	assert.equal(A.neighbourId(["a", "b", "c"], "x", 1), "a");
	assert.equal(A.neighbourId([], "x", 1), null);
});

// ---- docked preview ----
t("docked size: default 500×680, capped at 45 % × 80 % of the view", () => {
	assert.deepEqual(A.DOCK_DEFAULT, { w: 500, h: 680 });
	// big view: the default fits
	assert.deepEqual(A.clampDockSize(500, 680, 1600, 1000), { w: 500, h: 680 });
	// 1000×800 view: width cap 450, height cap 640
	assert.deepEqual(A.clampDockSize(500, 680, 1000, 800), { w: 450, h: 640 });
	// view resize re-clamps a saved size
	assert.deepEqual(A.clampDockSize(450, 640, 600, 500), { w: 270, h: 400 });
	// minimum, and garbage
	assert.deepEqual(A.clampDockSize(10, 10, 2000, 2000), { w: 240, h: 220 });
	assert.deepEqual(A.clampDockSize(NaN, undefined, 2000, 2000), { w: 240, h: 220 });
	// tiny view: the cap wins over the minimum
	assert.deepEqual(A.clampDockSize(500, 680, 300, 200), { w: 135, h: 160 });
	// dragging the upper-left handle left/up grows it
	assert.deepEqual(A.dockSizeFromDrag({ w: 400, h: 500 }, -50, -60, 2000, 1500), { w: 450, h: 560 });
	assert.deepEqual(A.dockSizeFromDrag({ w: 400, h: 500 }, 5000, 5000, 2000, 1500), { w: 240, h: 220 });
});

t("taggar line + dock reserved top", () => {
	assert.equal(A.parseGraphBlock("taggar: av").tags, false);
	assert.equal(A.parseGraphBlock("taggar: på").tags, true);
	assert.equal(A.parseGraphBlock("filter: tag: x").tags, null);
	// switch panel bottom at 300 px in a 1000 px view: room = 1000 - 300 - 10
	assert.deepEqual(A.clampDockSize(500, 680, 2000, 1000, 300), { w: 500, h: 680 });
	assert.deepEqual(A.clampDockSize(500, 680, 2000, 1000, 400), { w: 500, h: 590 });
	assert.deepEqual(A.dockSizeFromDrag({ w: 400, h: 500 }, -50, -600, 2000, 1000, 400), { w: 450, h: 590 });
});

t("thumbLanes: collections in lanes, same-day pages in a grid", () => {
	const D = 86400000;
	const rows = [];
	// A: days 0..10 (3 pages on day 0), B overlaps A (parallel lane), C starts after A ends (reuses lane 0)
	for (let k = 0; k < 7; k++) rows.push({ key: "A", day: 0, order: k });
	rows.push({ key: "A", day: 10 * D, order: 1 });
	rows.push({ key: "B", day: 5 * D, order: 1 }, { key: "B", day: 12 * D, order: 2 });
	rows.push({ key: "C", day: 20 * D, order: 1 });
	const o = { cols: 3, cellW: 10, cellH: 14, gap: 2 };
	const r = A.thumbLanes(rows, o);
	assert.equal(r.lanes, 2);
	assert.equal(r.centres.get("A"), r.centres.get("C"));
	assert.notEqual(r.centres.get("A"), r.centres.get("B"));
	const laneOf = (i) => Math.round(r.across[i] / r.laneWidth * 2) ; // not exact: use groups below
	// A and C share a lane, B has the other one
	const cA = r.across[0], cC = r.across[rows.length - 1], cB = r.across[8];
	assert.ok(Math.abs(cB - cA) > 30, "B beside A");
	assert.ok(Math.abs(cC - cA) < 14, "C reuses A's lane");
	// 7 same-day pages: columns -12, 0, 12 around the lane centre, rows 0, 16, 32 along
	assert.deepEqual([0, 1, 2].map((i) => r.across[i] - r.across[1]), [-12, 0, 12]);
	assert.deepEqual([0, 3, 6].map((i) => r.along[i]), [0, 16, 32]);
	assert.equal(r.along[7], 0);
	// deterministic and no two cards of one day share a cell
	const r2 = A.thumbLanes(rows, o);
	assert.deepEqual(Array.from(r2.across), Array.from(r.across));
	const cells = new Set(rows.map((x, i) => x.key + x.day + ":" + r.across[i] + ":" + r.along[i]));
	assert.equal(cells.size, rows.length);
	// 4 300 pages are laid out fast
	const big = [];
	for (let i = 0; i < 4300; i++) big.push({ key: "K" + (i % 58), day: Math.floor(i / 4) * D, order: i });
	const t0 = performance.now();
	A.thumbLanes(big, o);
	console.log(`  (thumbLanes of 4300: ${(performance.now() - t0).toFixed(1)} ms)`);
});

console.log(`cases: ${n}`);
