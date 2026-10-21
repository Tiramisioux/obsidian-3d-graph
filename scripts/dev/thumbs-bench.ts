import * as THREE from "three";
import { ThumbnailRenderer } from "../../src/rendering/thumbnail-renderer";
import { ThumbnailCache } from "../../src/rendering/thumbnail-cache";

const q = new URLSearchParams(location.search);
const N = +(q.get("n") ?? 4325), NS = 58;
const canvas = document.createElement("canvas");
document.body.style.margin = "0"; document.body.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(1200, 800); renderer.setPixelRatio(1);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x202024);
const cam = new THREE.PerspectiveCamera(50, 1.5, 1, 5000);
const cache = q.has("nocache") ? null : new ThumbnailCache(30000);
const host = {
  renderer: () => renderer, camera: () => cam,
  readBinary: async (p: string) => (await fetch(`/scans/${parseInt(p.split("/")[1]) % NS}.jpg`)).arrayBuffer(),
};
const tr = new ThumbnailRenderer(scene, host, cache);
const COLS = 90, SP = 16;
const items = Array.from({ length: N }, (_, i) => ({ nodeIndex: i, path: `fake/${i}.jpg`, mtime: 1, size: 1 }));
tr.init(items, N, 14, +(q.get("pages") ?? 7));
const pos = new Float32Array(N * 4);
for (let i = 0; i < N; i++) { pos[i*4] = (i % COLS - COLS/2) * SP; pos[i*4+1] = (Math.floor(i / COLS) - 24) * -SP; pos[i*4+2] = (i % 7) * 0.1; }
tr.setPositions(pos);
const frames: number[] = []; let last = performance.now(); const t0 = last; let doneAt = 0;
let zoomed = q.get("view") ?? "far";
function frame() {
  const now = performance.now(); frames.push(now - last); if (now - last > 200) (window as any).longs = ((window as any).longs||[]).concat([[Math.round(now - t0), Math.round(now - last), tr.getStats().loaded]]); last = now;
  const t = (now - t0) / 1000;
  const dist = zoomed === "far" ? 1100 : 160;
  cam.position.set(Math.sin(t * 0.2) * 60, 20, dist); cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(); tr.wake();
  renderer.render(scene, cam);
  const st = tr.getStats();
  if (!doneAt && st.loaded + st.failed >= st.thumbs) doneAt = now - t0;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as any).report = () => {
  const f = frames.slice(5).sort((a, b) => a - b);
  const pct = (p: number) => f[Math.floor(f.length * p)];
  return { stats: tr.getStats(), doneAtMs: doneAt, frames: f.length, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: f[f.length - 1],
    glErr: renderer.getContext().getError(), info: renderer.info.render, tex: renderer.info.memory };
};
(window as any).pickAt = (x: number, y: number) => { const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(x, y), cam); return tr.pick(rc, cam); };
(window as any).tr = tr; (window as any).cam = cam; (window as any).setView = (v: string) => { zoomed = v; };
