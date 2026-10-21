// fork: thumbnails as camera-facing textured quads (WP-G). One draw call for all of them.
//
//  * Atlas: GPU-only pages of 2048² RGBA8 (16 MiB each, at most `maxPages`, no mipmaps), cut into
//    fixed cells of CELL_W × CELL_H px. A thumbnail is copied into its cell with
//    renderer.copyTextureToTexture (a texSubImage2D of the ImageBitmap) — a few per frame, never a
//    whole page. The shader picks the page by a flat per-instance index.
//  * Loading: nearest to the camera first (in view before off screen; pure rules in
//    src/fork/analog.js). Per thumbnail: IndexedDB cache (small blob) → else vault.readBinary →
//    createImageBitmap(blob, { resizeHeight }) (decoded off the main thread). At most LOAD_CONCURRENCY
//    in flight, READY_MAX decoded bitmaps waiting, UPLOADS_PER_FRAME / UPLOAD_BUDGET_MS per frame.
//  * A thumbnail not loaded yet is a neutral placeholder card. When the atlas is full a loaded
//    thumbnail farther from the camera than the requester gives its cell up.
//  * Far away (quad < ~16 px tall) the card fades to a flat paper tone instead of shimmering.
import * as THREE from "three";
import * as A from "../fork/analog";
import { colorToRgb01 } from "./label-renderer";
import type { ThumbnailCache } from "./thumbnail-cache";

export const PAGE_SIZE = 2048;
export const CELL_W = 68;
export const CELL_H = 88;
const MAX_UNIFORM_PAGES = 8; // sampler uniforms in the shader
const LOAD_CONCURRENCY = 10; // Obsidian's main thread is busy while the layout runs: each IndexedDB read waits for it (~100 ms), so keep many in flight
const READY_MAX = 48;
const UPLOADS_PER_FRAME = 16;
const UPLOAD_BUDGET_MS = 3;
const RESORT_MS = 350;
const DEFAULT_ASPECT = 0.75;

export interface ThumbSource {
  nodeIndex: number;
  path: string;
  mtime: number;
  size: number;
}

export interface ThumbHost {
  renderer(): THREE.WebGLRenderer | null;
  camera(): THREE.Camera | null;
  readBinary(path: string): Promise<ArrayBuffer>;
}

export interface ThumbStats {
  thumbs: number;
  loaded: number;
  failed: number;
  fromCache: number;
  decoded: number;
  /** summed wall time of readBinary + createImageBitmap(resize) per scan, ms */
  decodeMs: number;
  cacheMs: number;
  uploads: number;
  uploadMs: number;
  maxUploadFrameMs: number;
  pages: number;
  atlasBytes: number;
}

const VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec2 iSize;
  attribute vec4 iUV;
  attribute float iPage;
  attribute float iHl;
  attribute vec3 iFrame;
  attribute float iBias;

  uniform float uViewH;

  varying vec2 vQ;
  varying vec2 vSize;
  varying vec4 vUV;
  flat varying float vPage;
  varying float vHl;
  varying vec3 vFrame;
  varying float vPx;

  void main() {
    vQ = vec2(uv.x, 1.0 - uv.y);
    vUV = iUV;
    vPage = iPage;
    vHl = iHl;
    vFrame = iFrame;
    vec2 size = iSize * (1.0 + 0.12 * iHl);
    vSize = size;
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    mv.xy += position.xy * size;
    // deterministic winner among overlapping (coplanar in 2D) cards; hovered one in front
    mv.z += iBias + iHl * 1.5;
    vPx = size.y * projectionMatrix[1][1] * 0.5 * uViewH / max(-mv.z, 0.001);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  precision mediump float;

  uniform sampler2D uPage0; uniform sampler2D uPage1; uniform sampler2D uPage2; uniform sampler2D uPage3;
  uniform sampler2D uPage4; uniform sampler2D uPage5; uniform sampler2D uPage6; uniform sampler2D uPage7;
  uniform vec3 uPlaceholder;
  uniform vec3 uHighlight;
  uniform vec3 uFar;

  varying vec2 vQ;
  varying vec2 vSize;
  varying vec4 vUV;
  flat varying float vPage;
  varying float vHl;
  varying vec3 vFrame;
  varying float vPx;

  vec3 page(int p, vec2 c) {
    if (p == 0) return texture2D(uPage0, c).rgb;
    if (p == 1) return texture2D(uPage1, c).rgb;
    if (p == 2) return texture2D(uPage2, c).rgb;
    if (p == 3) return texture2D(uPage3, c).rgb;
    if (p == 4) return texture2D(uPage4, c).rgb;
    if (p == 5) return texture2D(uPage5, c).rgb;
    if (p == 6) return texture2D(uPage6, c).rgb;
    return texture2D(uPage7, c).rgb;
  }

  void main() {
    float R = vSize.y * 0.035;
    vec2 q = abs(vQ - 0.5) * vSize - (vSize * 0.5 - vec2(R));
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - R;
    if (d > 0.0) discard;

    vec3 col;
    if (vUV.z <= 0.0) {
      col = uPlaceholder * (0.94 + 0.06 * step(0.5, fract(vQ.y * 14.0)));
    } else {
      col = page(int(vPage + 0.5), vUV.xy + clamp(vQ, 0.0, 1.0) * vUV.zw);
      col = mix(col, uFar, smoothstep(16.0, 7.0, vPx));
    }
    col *= 1.0 + 0.12 * min(vHl, 1.0);

    float h = clamp(vHl, 0.0, 1.0);
    float ringW = vSize.y * mix(0.018, 0.045, h);
    if (d > -ringW) {
      vec3 ring = mix(vFrame, uHighlight, h);
      col = mix(col, ring, mix(0.85, 1.0, h));
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

interface Page {
  tex: THREE.DataTexture;
}

interface ReadyItem {
  t: number;
  bmp: ImageBitmap;
  w: number;
  h: number;
  /** original aspect (width / height) of the scan, before fitting into the cell */
  aspect: number;
  gen: number;
}

export class ThumbnailRenderer {
  private mesh: THREE.Mesh | null = null;
  private geo: THREE.InstancedBufferGeometry | null = null;
  private mat: THREE.ShaderMaterial | null = null;
  private pages: (Page | undefined)[] = [];
  private dummy: THREE.DataTexture;
  private grid = A.atlasGrid(PAGE_SIZE, CELL_W, CELL_H);
  private alloc = new A.SlotAllocator(0);

  private n = 0;
  private items: ThumbSource[] = [];
  private nodeToThumb: Int32Array = new Int32Array(0);
  private height = 14;

  // instance data (index = thumbnail)
  private pos = new Float32Array(0);
  private size = new Float32Array(0);
  private uv = new Float32Array(0);
  private page = new Float32Array(0);
  private hl = new Float32Array(0);
  private frame = new Float32Array(0);
  private bias = new Float32Array(0);
  private attrs: Record<string, THREE.InstancedBufferAttribute> = {};
  private aspect = new Float32Array(0);

  // loading
  private state = new Uint8Array(0); // 0 idle, 1 loading, 2 decoded (waiting), 3 on the atlas, 4 failed
  private slot = new Int32Array(0);
  private keys: Float64Array<ArrayBufferLike> = new Float64Array(0);
  private order: number[] = [];
  private cursor = 0;
  private loadedSet = new Set<number>();
  private ready: ReadyItem[] = [];
  private inflight = 0;
  private gen = 0;
  private dirty = true;
  private lastSort = 0;
  private raf = 0;
  private disposed = false;
  private lastUploadFrameMs = 0;
  private pruned = false;

  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private tmp = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();
  private v2 = new THREE.Vector2();
  private sz = new THREE.Vector2();

  public stats: ThumbStats = {
    thumbs: 0, loaded: 0, failed: 0, fromCache: 0, decoded: 0, decodeMs: 0, cacheMs: 0,
    uploads: 0, uploadMs: 0, maxUploadFrameMs: 0, pages: 0, atlasBytes: 0,
  };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly host: ThumbHost,
    private readonly cache: ThumbnailCache | null,
  ) {
    this.dummy = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    this.dummy.needsUpdate = true;
  }

  /** (re)build for a node list: `items` are the nodes that have an image */
  public init(items: ThumbSource[], nodeCount: number, heightWorld: number, maxPages: number) {
    // a rebuild (the vault changed a little) keeps what is already on the atlas: thumbnails whose
    // path, mtime and size are unchanged keep their cell
    const prev = new Map<string, { slot: number; uv: number[]; page: number; aspect: number; mtime: number; size: number }>();
    for (const t of this.loadedSet) {
      const it = this.items[t];
      prev.set(it.path, {
        slot: this.slot[t], uv: Array.from(this.uv.subarray(t * 4, t * 4 + 4)), page: this.page[t],
        aspect: this.aspect[t], mtime: it.mtime, size: it.size,
      });
    }
    const keepPages = this.pages;
    this.pages = [];
    this.reset();
    this.height = heightWorld;
    this.items = items;
    this.n = items.length;
    this.nodeToThumb = new Int32Array(nodeCount).fill(-1);
    items.forEach((it, t) => { this.nodeToThumb[it.nodeIndex] = t; });
    this.stats = { ...this.stats, thumbs: this.n, loaded: 0, failed: 0, pages: 0, atlasBytes: 0 };
    if (this.n === 0) {
      keepPages.forEach((pg) => pg?.tex.dispose());
      return;
    }

    const pagesCap = Math.max(1, Math.min(MAX_UNIFORM_PAGES, Math.floor(maxPages)));
    const needed = Math.ceil(this.n / this.grid.perPage);
    const maxSlots = Math.min(pagesCap, needed) * this.grid.perPage;
    this.alloc = new A.SlotAllocator(maxSlots);
    this.pages = keepPages;

    const n = this.n;
    this.pos = new Float32Array(n * 3);
    this.size = new Float32Array(n * 2);
    this.uv = new Float32Array(n * 4);
    this.page = new Float32Array(n);
    this.hl = new Float32Array(n);
    this.frame = new Float32Array(n * 3).fill(0.5);
    this.bias = new Float32Array(n);
    this.aspect = new Float32Array(n).fill(DEFAULT_ASPECT);
    this.state = new Uint8Array(n);
    this.slot = new Int32Array(n).fill(-1);
    this.keys = new Float64Array(n);
    const kept: number[] = [];
    for (let t = 0; t < n; t++) {
      const it = items[t];
      this.size[t * 2] = heightWorld * DEFAULT_ASPECT;
      this.size[t * 2 + 1] = heightWorld;
      this.bias[t] = ((it.nodeIndex % 997) / 997) * 0.4;
      const old = prev.get(it.path);
      if (old && old.mtime === it.mtime && old.size === it.size && old.slot < maxSlots && keepPages[old.page]) {
        this.slot[t] = old.slot;
        this.uv.set(old.uv, t * 4);
        this.page[t] = old.page;
        this.aspect[t] = old.aspect;
        this.size[t * 2] = heightWorld * old.aspect;
        this.state[t] = 3;
        this.loadedSet.add(t);
        kept.push(old.slot);
      }
    }
    this.alloc = A.SlotAllocator.fromUsed(maxSlots, kept);

    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute("position", quad.getAttribute("position"));
    this.geo.setAttribute("uv", quad.getAttribute("uv"));
    quad.dispose();
    this.geo.instanceCount = n;
    const dyn = (name: string, data: Float32Array, size: number) => {
      const a = new THREE.InstancedBufferAttribute(data, size, false);
      a.setUsage(THREE.DynamicDrawUsage);
      this.geo!.setAttribute(name, a);
      this.attrs[name] = a;
    };
    dyn("iPos", this.pos, 3);
    dyn("iSize", this.size, 2);
    dyn("iUV", this.uv, 4);
    dyn("iPage", this.page, 1);
    dyn("iHl", this.hl, 1);
    dyn("iFrame", this.frame, 3);
    dyn("iBias", this.bias, 1);

    const uniforms: Record<string, THREE.IUniform> = {
      uViewH: { value: 1000 },
      uPlaceholder: { value: new THREE.Vector3(0.62, 0.62, 0.64) },
      uHighlight: { value: new THREE.Vector3(1, 0.72, 0) },
      uFar: { value: new THREE.Vector3(0.82, 0.81, 0.78) },
    };
    for (let p = 0; p < MAX_UNIFORM_PAGES; p++) uniforms[`uPage${p}`] = { value: this.dummy };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms,
      transparent: false,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    this.pages.forEach((pg, p) => { if (pg) this.mat!.uniforms[`uPage${p}`].value = pg.tex; });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    this.dirty = true;
    this.gen++;
    this.disposed = false;
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  public get count(): number { return this.n; }

  public hasThumb(nodeIndex: number): boolean {
    return nodeIndex >= 0 && nodeIndex < this.nodeToThumb.length && this.nodeToThumb[nodeIndex] >= 0;
  }

  /** path of the image of a node (for the lightbox / docked preview) */
  public pathOf(nodeIndex: number): string | null {
    const t = this.hasThumb(nodeIndex) ? this.nodeToThumb[nodeIndex] : -1;
    return t >= 0 ? this.items[t].path : null;
  }

  /** quad size [w, h] in world units of a node's thumbnail, or null */
  public sizeOf(nodeIndex: number): [number, number] | null {
    const t = this.hasThumb(nodeIndex) ? this.nodeToThumb[nodeIndex] : -1;
    return t >= 0 ? [this.size[t * 2], this.size[t * 2 + 1]] : null;
  }

  /** [w, h, 0] per node into `out` (3 per node; w = 0 where a node has no thumbnail) */
  public fillBoxes(out: Float32Array) {
    for (let t = 0; t < this.n; t++) {
      const i = this.items[t].nodeIndex * 3;
      if (i + 2 >= out.length) continue;
      out[i] = this.size[t * 2]; out[i + 1] = this.size[t * 2 + 1]; out[i + 2] = 0;
    }
  }

  public setHeight(h: number) {
    this.height = h;
    for (let t = 0; t < this.n; t++) {
      this.size[t * 2] = h * this.aspect[t];
      this.size[t * 2 + 1] = h;
    }
    if (this.attrs.iSize) this.attrs.iSize.needsUpdate = true;
  }

  public setStyle(placeholder: string, highlight: string) {
    if (!this.mat) return;
    (this.mat.uniforms.uPlaceholder.value as THREE.Vector3).fromArray(colorToRgb01(placeholder));
    (this.mat.uniforms.uHighlight.value as THREE.Vector3).fromArray(colorToRgb01(highlight));
  }

  /** frame colour per node (index = node index) */
  public setNodeColors(colors: Map<number, string> | string[]) {
    const entries: Iterable<[number, string]> = Array.isArray(colors) ? colors.entries() : colors;
    for (const [i, c] of entries) {
      const t = this.hasThumb(i) ? this.nodeToThumb[i] : -1;
      if (t < 0) continue;
      const rgb = colorToRgb01(c);
      this.frame[t * 3] = rgb[0]; this.frame[t * 3 + 1] = rgb[1]; this.frame[t * 3 + 2] = rgb[2];
    }
    if (this.attrs.iFrame) this.attrs.iFrame.needsUpdate = true;
  }

  /** hovered node 1, partial (time-grid period) ½ */
  public setHighlighted(nodeIndex: number | null, partial?: Set<number>) {
    if (!this.n) return;
    this.hl.fill(0);
    if (partial) for (const i of partial) { const t = this.hasThumb(i) ? this.nodeToThumb[i] : -1; if (t >= 0) this.hl[t] = 0.5; }
    if (nodeIndex !== null) { const t = this.hasThumb(nodeIndex) ? this.nodeToThumb[nodeIndex] : -1; if (t >= 0) this.hl[t] = 1; }
    this.attrs.iHl.needsUpdate = true;
  }

  /** positions of all nodes (x, y, z, w per node) */
  public setPositions(positions: Float32Array, stride = 4) {
    if (!this.n) return;
    for (let t = 0; t < this.n; t++) {
      const s = this.items[t].nodeIndex * stride;
      if (s + 2 >= positions.length) continue;
      this.pos[t * 3] = positions[s]; this.pos[t * 3 + 1] = positions[s + 1]; this.pos[t * 3 + 2] = positions[s + 2];
    }
    this.attrs.iPos.needsUpdate = true;
    this.dirty = true;
  }

  /** the camera moved (or anything else that changes what is near) */
  public wake() { this.dirty = true; }

  /** node index of the nearest thumbnail under the ray, or null */
  public pick(raycaster: THREE.Raycaster, camera: THREE.Camera): number | null {
    if (!this.n) return null;
    camera.getWorldDirection(this.fwd);
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    this.up.setFromMatrixColumn(camera.matrixWorld, 1);
    const i = A.pickQuad(raycaster.ray.origin, raycaster.ray.direction, this.fwd, this.right, this.up, this.pos, this.size, this.n);
    return i >= 0 ? this.items[i].nodeIndex : null;
  }

  public getStats(): ThumbStats {
    return {
      ...this.stats,
      loaded: this.loadedSet.size,
      pages: this.pages.length,
      atlasBytes: this.pages.length * PAGE_SIZE * PAGE_SIZE * 4,
    };
  }

  // ---- the per-frame pump --------------------------------------------------------

  private loop = () => {
    this.raf = 0;
    if (this.disposed || !this.mesh) return;
    try {
      this.tick();
    } catch (e) {
      console.error("[3D Graph] thumbnails:", e);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private tick() {
    const renderer = this.host.renderer(), camera = this.host.camera();
    if (!renderer || !camera || !this.mat) return;
    renderer.getDrawingBufferSize(this.sz);
    this.mat.uniforms.uViewH.value = this.sz.y;

    this.uploadReady(renderer);

    const now = performance.now();
    if (this.dirty && now - this.lastSort >= RESORT_MS) {
      this.dirty = false;
      this.lastSort = now;
      this.resort(camera);
    }
    this.launchLoads();
    if (!this.pruned && this.inflight === 0 && !this.ready.length && this.cursor >= this.order.length) {
      this.pruned = true;
      void this.cache?.prune();
    }
  }

  private resort(camera: THREE.Camera) {
    camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices((camera as THREE.PerspectiveCamera).projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const cp = camera.position;
    this.keys = A.priorityKeys(this.pos, this.n, { x: cp.x, y: cp.y, z: cp.z },
      (x, y, z) => this.frustum.containsPoint(this.tmp.set(x, y, z)), this.keys);
    this.order = A.loadOrder(this.keys, this.n);
    this.cursor = 0;
  }

  private launchLoads() {
    const batch: number[] = [];
    while (this.inflight + batch.length < LOAD_CONCURRENCY && this.ready.length + this.inflight + batch.length < READY_MAX) {
      while (this.cursor < this.order.length && this.state[this.order[this.cursor]] !== 0) this.cursor++;
      if (this.cursor >= this.order.length) break;
      const t = this.order[this.cursor];
      // a cell for it: a free one, else the farthest loaded thumbnail's (only if farther than t)
      let slot = this.alloc.alloc();
      if (slot === null) {
        const v = A.evictionVictim(this.keys, this.loadedSet, this.keys[t]);
        if (v < 0) break; // nothing to give: the atlas holds the nearest ones already
        slot = this.slot[v];
        this.slot[v] = -1;
        this.state[v] = 0;
        this.loadedSet.delete(v);
        this.uv[v * 4 + 2] = 0; // back to a placeholder
        this.attrs.iUV.needsUpdate = true;
      }
      this.slot[t] = slot;
      this.state[t] = 1;
      this.cursor++;
      batch.push(t);
    }
    if (!batch.length) return;
    this.inflight += batch.length;
    // the cache lookups of the whole batch in one IndexedDB transaction
    const recs = this.cache ? this.cache.getMany(batch.map((t) => this.items[t])) : null;
    batch.forEach((t, i) => void this.load(t, this.gen, recs ? recs.then((a) => a[i]) : null));
  }

  private async load(t: number, gen: number, rec: Promise<import("./thumbnail-cache").CachedThumb | null> | null) {
    const it = this.items[t];
    let bmp: ImageBitmap | null = null;
    let aspect = DEFAULT_ASPECT;
    try {
      const t0 = performance.now();
      const cached = rec ? await rec : null;
      if (cached) {
        bmp = await createImageBitmap(cached.blob);
        aspect = cached.w / Math.max(1, cached.h);
        this.stats.fromCache++;
        this.stats.cacheMs += performance.now() - t0;
        // the stored thumbnail was fitted into the cell; its true aspect rides in the record
        aspect = cached.aspect || aspect;
      } else {
        const buf = await this.host.readBinary(it.path);
        let b = await createImageBitmap(new Blob([buf], { type: mimeOf(it.path) }), {
          resizeHeight: CELL_H,
          resizeQuality: "high",
        });
        aspect = b.width / Math.max(1, b.height);
        if (b.width > CELL_W) {
          const fit = A.fitCell(b.width, b.height, CELL_W, CELL_H);
          const b2 = await createImageBitmap(b, { resizeWidth: fit.w, resizeHeight: fit.h, resizeQuality: "high" });
          b.close();
          b = b2;
        }
        bmp = b;
        this.stats.decoded++;
        this.stats.decodeMs += performance.now() - t0;
        this.storeInCache(it, bmp, aspect);
      }
    } catch (e) {
      bmp?.close();
      bmp = null;
    }
    if (gen !== this.gen || this.disposed) { bmp?.close(); return; } // a newer init() reset the counters
    this.inflight--;
    if (!bmp) {
      this.state[t] = 4;
      this.stats.failed++;
      this.alloc.free(this.slot[t]);
      this.slot[t] = -1;
      this.launchLoads();
      return;
    }
    this.state[t] = 2;
    this.ready.push({ t, bmp, w: bmp.width, h: bmp.height, aspect, gen });
    this.launchLoads(); // keep the pipeline full without waiting for the next frame
  }

  private storeInCache(it: ThumbSource, bmp: ImageBitmap, aspect: number) {
    if (!this.cache || typeof OffscreenCanvas === "undefined") return;
    try {
      const oc = new OffscreenCanvas(bmp.width, bmp.height);
      oc.getContext("2d")!.drawImage(bmp, 0, 0);
      const w = bmp.width, h = bmp.height;
      void oc.convertToBlob({ type: "image/webp", quality: 0.85 }).then((blob) => {
        this.cache!.put({ path: it.path, mtime: it.mtime, size: it.size, w, h, blob, used: Date.now(), aspect });
      }, () => undefined);
    } catch {
      /* the cache is optional */
    }
  }

  private ensurePage(p: number, renderer: THREE.WebGLRenderer): Page {
    let pg = this.pages[p];
    if (pg) return pg;
    const tex = new THREE.DataTexture(new Uint8Array(PAGE_SIZE * PAGE_SIZE * 4), PAGE_SIZE, PAGE_SIZE, THREE.RGBAFormat);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.flipY = false;
    tex.needsUpdate = true;
    renderer.initTexture(tex); // allocates the GPU storage now
    (tex.image as { data: unknown }).data = null; // ...and the CPU copy can go: later writes are sub-rectangles
    pg = { tex };
    this.pages[p] = pg;
    if (this.mat) this.mat.uniforms[`uPage${p}`].value = tex;
    return pg;
  }

  private uploadReady(renderer: THREE.WebGLRenderer) {
    if (!this.ready.length) { this.lastUploadFrameMs = 0; return; }
    const t0 = performance.now();
    let done = 0;
    while (this.ready.length && done < UPLOADS_PER_FRAME && (done === 0 || performance.now() - t0 < UPLOAD_BUDGET_MS)) {
      const r = this.ready.shift()!;
      if (r.gen !== this.gen || this.state[r.t] !== 2) { r.bmp.close(); continue; }
      const rect = A.slotRect(this.slot[r.t], this.grid);
      const pg = this.ensurePage(rect.page, renderer);
      const src = new THREE.Texture(r.bmp as unknown as HTMLImageElement);
      renderer.copyTextureToTexture(src, pg.tex, null, this.v2.set(rect.x, rect.y));
      src.dispose();
      r.bmp.close();
      const t = r.t;
      this.uv[t * 4] = rect.x / PAGE_SIZE;
      this.uv[t * 4 + 1] = rect.y / PAGE_SIZE;
      this.uv[t * 4 + 2] = r.w / PAGE_SIZE;
      this.uv[t * 4 + 3] = r.h / PAGE_SIZE;
      this.page[t] = rect.page;
      this.aspect[t] = r.aspect;
      this.size[t * 2] = this.height * r.aspect;
      this.state[t] = 3;
      this.loadedSet.add(t);
      done++;
      this.stats.uploads++;
    }
    if (done) {
      for (const k of ["iUV", "iPage", "iSize"]) this.attrs[k].needsUpdate = true;
      const ms = performance.now() - t0;
      this.stats.uploadMs += ms;
      this.lastUploadFrameMs = ms;
      this.stats.maxUploadFrameMs = Math.max(this.stats.maxUploadFrameMs, ms);
    }
  }

  // ---- teardown --------------------------------------------------------------------

  private reset() {
    this.gen++;
    for (const r of this.ready) r.bmp.close();
    this.ready = [];
    this.inflight = 0;
    this.loadedSet.clear();
    this.order = [];
    this.cursor = 0;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh = null;
    }
    this.geo?.dispose();
    this.mat?.dispose();
    this.geo = null;
    this.mat = null;
    this.attrs = {};
    this.pages.forEach((p) => p?.tex.dispose());
    this.pages = [];
    this.n = 0;
    this.items = [];
    this.nodeToThumb = new Int32Array(0);
    this.pruned = false;
  }

  public clear() {
    this.reset();
  }

  public dispose() {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.reset();
    this.dummy.dispose();
  }
}

function mimeOf(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  const e = m ? m[1].toLowerCase() : "";
  return e === "jpg" || e === "jpeg" ? "image/jpeg" : e === "png" ? "image/png" : e === "webp" ? "image/webp" : e === "gif" ? "image/gif" : e === "avif" ? "image/avif" : "image/bmp";
}
