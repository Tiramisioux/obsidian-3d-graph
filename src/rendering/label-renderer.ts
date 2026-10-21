import * as THREE from "three";
import { type Graph3DPluginSettings, type GraphNode, NodeType } from "../types";

export interface LabelItem {
  id: string;
  name: string;
  type: NodeType;
  nodeIndex: number;
  size: number;
  /** fork: extra lift for multi-line labels */
  lift?: number;
}

interface AtlasGlyph {
  u: number;
  v: number;
  w: number;
  h: number;
  pixelWidth: number;
  pixelHeight: number;
  aspect: number;
  /** fork: number of text lines in this glyph */
  lines: number;
}

const LABEL_VERT = /* glsl */ `
  attribute vec3 instanceTranslation;
  attribute vec2 instanceScale;
  attribute vec4 instanceUV;
  attribute float instanceOpacity;
  attribute float instanceHighlight; // fork: 1 = hovered, 0.5 = time-grid period, 0 = none
  attribute vec4 instanceColor;      // fork: node colour (rgb) + tint weight (a; 0 = white)

  varying vec2 vUv;
  varying float vOpacity;
  varying float vHighlight;
  varying vec4 vColor;

  void main() {
    vOpacity = instanceOpacity;
    vHighlight = instanceHighlight;
    vColor = instanceColor;
    vUv = vec2(instanceUV.x + uv.x * instanceUV.z, instanceUV.y + (1.0 - uv.y) * instanceUV.w);

    // Billboarding in view space: quad faces the camera
    vec4 mvPosition = modelViewMatrix * vec4(instanceTranslation, 1.0);
    mvPosition.xy += position.xy * instanceScale * (1.0 + 0.12 * instanceHighlight);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

/* fork: the atlas holds masks, not colours — red = card, green = text,
   blue = outline, alpha = card coverage. Colours are applied here, so every
   label can carry its node's colour without one atlas glyph per colour. */
const LABEL_FRAG = /* glsl */ `
  precision mediump float;

  uniform sampler2D uAtlas;
  uniform vec3 uBgColor;
  uniform float uBgOpacity;
  uniform vec3 uTextColor;
  uniform float uBorderOpacity;
  uniform float uTintRest;
  uniform float uTintHover;
  uniform vec3 uHighlightColor; // hover tint for nodes without an own colour (white)

  varying vec2 vUv;
  varying float vOpacity;
  varying float vHighlight;
  varying vec4 vColor;

  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  void main() {
    if (vOpacity < 0.005) {
      discard;
    }
    vec4 m = texture2D(uAtlas, vUv);
    if (m.a < 0.01) {
      discard;
    }
    float h = clamp(vHighlight, 0.0, 1.0);
    float w = vColor.a;
    vec3 tintColor = mix(uHighlightColor, vColor.rgb, w);
    // faint own-colour card at rest, clearly stronger on hover
    float amount = mix(uTintRest * w, uTintHover, h);
    vec3 card = mix(uBgColor, tintColor, amount);
    float cardA = max(uBgOpacity, 0.95 * h);

    vec3 borderColor = mix(uTextColor, tintColor, w);
    float border = m.b * mix(uBorderOpacity, max(uBorderOpacity, 0.55), w);

    // text keeps its contrast against a (mostly) opaque tinted card; on
    // see-through cards the scene behind decides, so the theme colour stays
    vec3 text = uTextColor;
    float lc = lum(card);
    if (cardA >= 0.6 && abs(lc - lum(text)) < 0.45) text = lc > 0.5 ? vec3(0.08) : vec3(0.96);

    vec3 rgb = mix(card, borderColor, border);
    rgb = mix(rgb, text, m.g);
    float a = cardA + (1.0 - cardA) * max(m.g, border);
    gl_FragColor = vec4(rgb, m.a * a * vOpacity);
  }
`;

/**
 * fork: label text for a note/attachment — the file name minus
 * `labelStripPattern` (a regex, e.g. `^\\d{14}\\s+` for a Zettelkasten
 * timestamp), optionally with underscores shown as spaces. Never empty:
 * falls back to the unformatted name.
 */
export function formatLabel(name: string, settings: Graph3DPluginSettings): string {
  let out = name;
  const pattern = (settings.labelStripPattern || "").trim();
  if (pattern) {
    try {
      out = out.replace(new RegExp(pattern, "u"), "");
    } catch {
      /* invalid regex: leave the name as is */
    }
  }
  if (settings.labelUnderscoresToSpaces) out = out.replace(/_/g, " ");
  out = out.trim();
  return out || name;
}

/**
 * fork: a label split into lines of about `labelWrapChars` characters at word
 * boundaries (max 3 lines, the rest cut with "…"); a word longer than a line
 * is broken. With wrapping off (0) the old rule: one line, max 40 characters.
 */
export function labelLines(name: string, settings: Graph3DPluginSettings, maxLines = 3): string[] {
  const width = settings.labelWrapChars || 0;
  if (width <= 0) return [name.length > 40 ? `${name.substring(0, 38)}…` : name];
  const words = name.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (let word of words) {
    while (word.length > width) {                       // break an over-long word
      if (cur) { lines.push(cur); cur = ""; }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= width) cur += ` ${word}`;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, Math.max(1, width - 1))}…`;
    return kept;
  }
  return lines.length ? lines : [name];
}

/** fork: what the label shader needs besides the atlas — set from the
 *  settings and the theme, no atlas rebuild needed */
export interface LabelStyle {
  textColor: string;
  bgColor: string;
  bgOpacity: number;
  borderOpacity: number;
  tintRest: number;
  tintHover: number;
  highlightColor: string;
}

export function labelStyleFrom(settings: Graph3DPluginSettings, highlightColor: string): LabelStyle {
  const isDarkMode = document.body.classList.contains("theme-dark");
  return {
    textColor: isDarkMode ? settings.labelTextColorDark : settings.labelTextColorLight,
    bgColor: settings.labelBackgroundColor,
    bgOpacity: settings.labelBackgroundOpacity,
    borderOpacity: settings.labelBorderOpacity,
    tintRest: settings.labelTintOpacity,
    tintHover: settings.labelTintHoverOpacity,
    highlightColor,
  };
}

/** fork: "#rrggbb" / "rgb(r, g, b)" → raw 0–1 channels (the shaders take
 *  colours as they are, like the node shader) */
export function colorToRgb01(color: string): [number, number, number] {
  const c = (color || "").trim();
  if (c.startsWith("rgb")) {
    const m = c.match(/\d+(\.\d+)?/g);
    if (m && m.length >= 3) return [+m[0] / 255, +m[1] / 255, +m[2] / 255];
  }
  let hex = c.replace("#", "");
  if (hex.length === 3) hex = hex.split("").map((x) => x + x).join("");
  const n = parseInt(hex.substring(0, 6), 16);
  if (isNaN(n)) return [0.5, 0.5, 0.5];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class InstancedLabelRenderer {
  private scene: THREE.Scene;
  private atlasCanvas: HTMLCanvasElement;
  private atlasCtx: CanvasRenderingContext2D;
  private atlasTexture: THREE.CanvasTexture | null = null;
  private atlasWidth = 2048;
  private atlasHeight = 2048;

  private atlasCursorX = 0;
  private atlasCursorY = 0;
  private atlasRowHeight = 0;
  private labelCache = new Map<string, AtlasGlyph>();

  public instancedMesh: THREE.Mesh | null = null;
  private instancedGeo: THREE.InstancedBufferGeometry | null = null;
  // GPU attributes, in DRAW order (slot), only the visible labels, farthest
  // first — fork: sorted back to front instead of depth-written (see below)
  private translationAttr: THREE.InstancedBufferAttribute | null = null;
  private scaleAttr: THREE.InstancedBufferAttribute | null = null;
  private uvAttr: THREE.InstancedBufferAttribute | null = null;
  private opacityAttr: THREE.InstancedBufferAttribute | null = null;
  private highlightAttr: THREE.InstancedBufferAttribute | null = null; // fork
  private colorAttr: THREE.InstancedBufferAttribute | null = null; // fork
  private material: THREE.ShaderMaterial | null = null;

  private labels: LabelItem[] = [];
  private labelCount = 0;
  private positionsStride: 4 | 3 = 4;

  // fork: per-LABEL data (index = label = node index), copied into the
  // draw-order slots on every visibility pass
  private labelScale = new Float32Array(0);
  private labelUV = new Float32Array(0);
  private labelColor = new Float32Array(0); // rgb + tint weight
  private labelHighlight = new Float32Array(0);
  private labelTrans = new Float32Array(0);
  private labelBoxCache = new Float32Array(0);
  private labelOpacity = new Float32Array(0);
  private labelDistSq = new Float32Array(0);
  private slotLabel = new Int32Array(0); // slot → label
  private visibleCount = 0;
  private style: LabelStyle | null = null;
  /** fork: labels left out (thumbnail nodes) — 1 = no label; index = node index */
  private suppressed: Uint8Array | null = null;
  /** fork: label box replaced by a thumbnail's — [w, h, centre above node] per node, w ≤ 0 = none */
  private boxOverride: Float32Array | null = null;
  private extraLift: Float32Array | null = null;

  // Frustum & raycast occlusion reusable objects
  private projScreenMatrix = new THREE.Matrix4();
  private frustum = new THREE.Frustum();
  private tempNodePos = new THREE.Vector3();
  private tempCamToNode = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.atlasCanvas = document.createElement("canvas");
    this.atlasCanvas.width = this.atlasWidth;
    this.atlasCanvas.height = this.atlasHeight;
    const ctx = this.atlasCanvas.getContext("2d", { willReadFrequently: false });
    if (!ctx) throw new Error("Failed to create 2D canvas context for label atlas");
    this.atlasCtx = ctx;
  }

  /** fork: leave out the labels of these nodes (null = none); takes effect with the next pass */
  public setSuppressed(mask: Uint8Array | null) {
    this.suppressed = mask;
  }

  /** fork: the box a node takes in the separation pass instead of its label (a thumbnail) */
  /** fork: extra lift per node (index = node index) — a label above its node's thumbnail */
  public setExtraLift(lift: Float32Array | null) {
    this.extraLift = lift;
  }

  public setBoxOverride(boxes: Float32Array | null) {
    this.boxOverride = boxes;
  }

  /** fork: label under a ray — intersects the ray with each drawn label's
   *  camera-facing quad (the vertex shader billboards it in view space);
   *  returns the node index of the nearest hit, or null */
  public getNodeIndexAtLabel(raycaster: THREE.Raycaster, camera: THREE.Camera): number | null {
    if (!this.translationAttr || !this.scaleAttr || !this.opacityAttr || !this.instancedMesh?.visible) return null;
    const tr = this.translationAttr.array as Float32Array, sc = this.scaleAttr.array as Float32Array;
    const op = this.opacityAttr.array as Float32Array;
    const o = raycaster.ray.origin, d = raycaster.ray.direction;
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const denom = d.dot(fwd);
    if (Math.abs(denom) < 1e-6) return null;
    const c = new THREE.Vector3(), p = new THREE.Vector3();
    let best: number | null = null, bestT = Infinity;
    for (let s = 0; s < this.visibleCount; s++) {
      if (op[s] < 0.05) continue;
      c.set(tr[s * 3], tr[s * 3 + 1], tr[s * 3 + 2]);
      const t = c.clone().sub(o).dot(fwd) / denom;
      if (t <= 0 || t >= bestT) continue;
      p.copy(d).multiplyScalar(t).add(o).sub(c);
      if (Math.abs(p.dot(right)) <= sc[s * 2] / 2 && Math.abs(p.dot(up)) <= sc[s * 2 + 1] / 2) {
        best = this.labels[this.slotLabel[s]].nodeIndex; bestT = t;
      }
    }
    return best;
  }

  /** fork: highlight the label of one node (null = none) — the hover state.
   *  Labels in `partial` (node indices) get a half highlight (time-grid
   *  period). Takes effect with the next visibility pass. */
  public setHighlightedNode(nodeIndex: number | null, partial?: Set<number>) {
    this.labelHighlight.fill(0);
    if (partial) for (const i of partial) if (i >= 0 && i < this.labelCount) this.labelHighlight[i] = 0.5;
    if (nodeIndex !== null && nodeIndex >= 0 && nodeIndex < this.labelCount) this.labelHighlight[nodeIndex] = 1;
  }

  /** fork: each label's colour = its node's resolved colour (index = node
   *  index). Near-white colours get tint weight 0 → today's plain card. */
  public setNodeColors(colors: Map<number, string> | string[]) {
    const entries: Iterable<[number, string]> = Array.isArray(colors) ? colors.entries() : colors;
    for (const [i, color] of entries) {
      if (i < 0 || i >= this.labelCount) continue;
      const [r, g, b] = colorToRgb01(color);
      const min = Math.min(r, g, b);
      const weight = 1 - Math.min(1, Math.max(0, (min - 0.9) / 0.08)); // ≥ ~0.98 in every channel → 0
      this.labelColor.set([r, g, b, weight], i * 4);
    }
    this.writeSlots();
  }

  /** fork: theme / settings colours and tint strengths */
  public setStyle(style: LabelStyle) {
    this.style = style;
    if (!this.material) return;
    const u = this.material.uniforms;
    (u.uBgColor.value as THREE.Vector3).fromArray(colorToRgb01(style.bgColor));
    (u.uTextColor.value as THREE.Vector3).fromArray(colorToRgb01(style.textColor));
    (u.uHighlightColor.value as THREE.Vector3).fromArray(colorToRgb01(style.highlightColor));
    u.uBgOpacity.value = style.bgOpacity;
    u.uBorderOpacity.value = style.borderOpacity;
    u.uTintRest.value = style.tintRest;
    u.uTintHover.value = style.tintHover;
  }

  public initLabels(
    nodes: GraphNode[],
    settings: Graph3DPluginSettings,
    positionsStride: 4 | 3 = 4,
  ): void {
    this.clear();
    this.positionsStride = positionsStride;

    this.labels = nodes.map((node, idx) => {
      let size: number;
      switch (node.type) {
        case NodeType.Tag:
          size = settings.tagNodeSize;
          break;
        case NodeType.Attachment:
          size = settings.attachmentNodeSize;
          break;
        default:
          size = settings.nodeSize;
      }
      return {
        id: node.id,
        name: node.type === NodeType.Tag ? node.name || node.id : formatLabel(node.name || node.id, settings),
        type: node.type,
        nodeIndex: idx,
        size: size * 1.5,
      };
    });

    this.labelCount = this.labels.length;
    if (this.labelCount === 0) return;

    const n = this.labelCount;
    this.labelScale = new Float32Array(n * 2);
    this.labelUV = new Float32Array(n * 4);
    this.labelColor = new Float32Array(n * 4); // rgb 0 + weight 0 = plain card until coloured
    this.labelHighlight = new Float32Array(n);
    this.labelTrans = new Float32Array(n * 3);
    this.labelOpacity = new Float32Array(n);
    this.labelDistSq = new Float32Array(n);
    this.slotLabel = new Int32Array(n);
    this.visibleCount = 0;

    this.buildAtlas(settings);
    this.setupInstancedMesh(settings);
  }

  private buildAtlas(settings: Graph3DPluginSettings): void {
    // fork: masks only (see LABEL_FRAG) — colours are uniforms
    const CARD = "rgb(255, 0, 0)", TEXT = "rgb(0, 255, 0)", BORDER = "rgb(0, 0, 255)";

    // Count unique labels to choose optimal texture size
    const uniqueTexts = new Set<string>();
    for (let i = 0; i < this.labelCount; i++) {
      uniqueTexts.add(this.labels[i].name);
    }
    const uniqueCount = uniqueTexts.size;

    // Dynamically choose atlas size: 2048 for <1200 unique labels, 4096 for larger graphs
    if (uniqueCount > 1200) {
      this.atlasWidth = 4096;
      this.atlasHeight = 4096;
    } else {
      this.atlasWidth = 2048;
      this.atlasHeight = 2048;
    }

    this.atlasCanvas.width = this.atlasWidth;
    this.atlasCanvas.height = this.atlasHeight;

    // Reset atlas canvas
    this.atlasCtx.clearRect(0, 0, this.atlasWidth, this.atlasHeight);
    this.atlasCursorX = 2;
    this.atlasCursorY = 2;
    this.atlasRowHeight = 0;
    this.labelCache.clear();

    const fontSize = 20; // Crisp high-DPI font size with optimal atlas packing density
    this.atlasCtx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif`;
    this.atlasCtx.textBaseline = "middle";

    const paddingX = 8;
    const paddingY = 4;
    const borderRadius = 6;

    // Create a fallback slot at (2, 2)
    const fallbackBoxW = 40;
    const fallbackBoxH = fontSize + paddingY * 2;
    this.atlasCtx.fillStyle = CARD;
    this.drawRoundedRect(this.atlasCtx, 2, 2, fallbackBoxW, fallbackBoxH, borderRadius);
    this.atlasCtx.fill();
    this.atlasCursorX += fallbackBoxW + 2;
    this.atlasRowHeight = fallbackBoxH;

    const fallbackGlyph: AtlasGlyph = {
      u: 2 / this.atlasWidth,
      v: 2 / this.atlasHeight,
      w: fallbackBoxW / this.atlasWidth,
      h: fallbackBoxH / this.atlasHeight,
      pixelWidth: fallbackBoxW,
      pixelHeight: fallbackBoxH,
      aspect: fallbackBoxW / fallbackBoxH,
      lines: 1,
    };
    this.labelCache.set("__FALLBACK__", fallbackGlyph);

    for (let i = 0; i < this.labelCount; i++) {
      // fork: wrapped into lines (or truncated to one line when wrapping is off)
      const lines = labelLines(this.labels[i].name, settings);
      const text = lines.join("\n");

      const cacheKey = text;
      if (this.labelCache.has(cacheKey)) continue;

      const lineHeight = Math.round(fontSize * 1.15);
      const textWidth = Math.ceil(Math.max(...lines.map((l) => this.atlasCtx.measureText(l).width)));
      const boxWidth = textWidth + paddingX * 2;
      const boxHeight = fontSize + paddingY * 2 + (lines.length - 1) * lineHeight;

      // Atlas row wrapping
      if (this.atlasCursorX + boxWidth + 2 > this.atlasWidth) {
        this.atlasCursorX = 2;
        this.atlasCursorY += this.atlasRowHeight + 2;
        this.atlasRowHeight = 0;
      }

      if (this.atlasCursorY + boxHeight + 2 > this.atlasHeight) {
        // Atlas full - map remaining labels to fallback glyph
        break;
      }

      const x = this.atlasCursorX;
      const y = this.atlasCursorY;

      // Draw background rounded pill
      this.atlasCtx.fillStyle = CARD;
      this.drawRoundedRect(this.atlasCtx, x, y, boxWidth, boxHeight, borderRadius);
      this.atlasCtx.fill();
      // fork: rounded outline mask (its opacity and colour come from the
      // shader), so overlapping labels read as separate cards
      this.atlasCtx.strokeStyle = BORDER;
      this.atlasCtx.lineWidth = 1.5;
      this.drawRoundedRect(this.atlasCtx, x + 0.75, y + 0.75, boxWidth - 1.5, boxHeight - 1.5, borderRadius);
      this.atlasCtx.stroke();

      // Draw text
      this.atlasCtx.fillStyle = TEXT;
      lines.forEach((line, k) => {
        this.atlasCtx.fillText(line, x + paddingX, y + paddingY + fontSize / 2 + k * lineHeight);
      });

      // Save UV rect
      const u = x / this.atlasWidth;
      const v = y / this.atlasHeight;
      const w = boxWidth / this.atlasWidth;
      const h = boxHeight / this.atlasHeight;

      this.labelCache.set(cacheKey, {
        u,
        v,
        w,
        h,
        pixelWidth: boxWidth,
        pixelHeight: boxHeight,
        aspect: boxWidth / boxHeight,
        lines: lines.length,
      });

      this.atlasCursorX += boxWidth + 2;
      if (boxHeight > this.atlasRowHeight) {
        this.atlasRowHeight = boxHeight;
      }
    }

    if (this.atlasTexture) {
      this.atlasTexture.dispose();
    }
    this.atlasTexture = new THREE.CanvasTexture(this.atlasCanvas);
    // fork fix: the shader's UVs are top-down canvas coordinates; the default
    // flipY upload made every label sample the wrong (often empty) atlas rows
    this.atlasTexture.flipY = false;
    this.atlasTexture.minFilter = THREE.LinearFilter;
    this.atlasTexture.magFilter = THREE.LinearFilter;
    this.atlasTexture.generateMipmaps = false;
    this.atlasTexture.needsUpdate = true;
  }

  private drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private setupInstancedMesh(settings: Graph3DPluginSettings): void {
    if (this.labelCount === 0 || !this.atlasTexture) return;

    const quadGeo = new THREE.PlaneGeometry(1, 1);
    this.instancedGeo = new THREE.InstancedBufferGeometry();
    this.instancedGeo.index = quadGeo.index;
    this.instancedGeo.setAttribute("position", quadGeo.getAttribute("position"));
    this.instancedGeo.setAttribute("uv", quadGeo.getAttribute("uv"));
    this.instancedGeo.instanceCount = 0; // fork: = visible labels, set per pass
    quadGeo.dispose();

    const n = this.labelCount;
    const baseHeight = settings.labelTextSize * 2.2;

    for (let i = 0; i < n; i++) {
      const text = labelLines(this.labels[i].name, settings).join("\n");
      const glyph =
        this.labelCache.get(text) ||
        this.labelCache.get("__FALLBACK__") ||
        this.labelCache.values().next().value;

      if (glyph) {
        this.labelUV[i * 4] = glyph.u;
        this.labelUV[i * 4 + 1] = glyph.v;
        this.labelUV[i * 4 + 2] = glyph.w;
        this.labelUV[i * 4 + 3] = glyph.h;

        // fork: taller box for wrapped labels (same text size), lifted by the
        // extra height so it doesn't cover its own node
        const h = baseHeight * (glyph.pixelHeight / 28); // 28 px = one-line box (20 px font + 2×4 padding)
        const w = h * glyph.aspect;
        this.labels[i].lift = (h - baseHeight) / 2;
        this.labelScale[i * 2] = w;
        this.labelScale[i * 2 + 1] = h;
      }
    }

    const dyn = (data: Float32Array, size: number) => {
      const a = new THREE.InstancedBufferAttribute(data, size, false);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.translationAttr = dyn(new Float32Array(n * 3), 3);
    this.scaleAttr = dyn(new Float32Array(n * 2), 2);
    this.uvAttr = dyn(new Float32Array(n * 4), 4);
    this.opacityAttr = dyn(new Float32Array(n), 1);
    this.highlightAttr = dyn(new Float32Array(n), 1); // fork: hover / period highlight
    this.colorAttr = dyn(new Float32Array(n * 4), 4); // fork: node colour + tint weight

    this.instancedGeo.setAttribute("instanceTranslation", this.translationAttr);
    this.instancedGeo.setAttribute("instanceScale", this.scaleAttr);
    this.instancedGeo.setAttribute("instanceUV", this.uvAttr);
    this.instancedGeo.setAttribute("instanceOpacity", this.opacityAttr);
    this.instancedGeo.setAttribute("instanceHighlight", this.highlightAttr);
    this.instancedGeo.setAttribute("instanceColor", this.colorAttr);

    this.material = new THREE.ShaderMaterial({
      vertexShader: LABEL_VERT,
      fragmentShader: LABEL_FRAG,
      uniforms: {
        uAtlas: { value: this.atlasTexture },
        uBgColor: { value: new THREE.Vector3(1, 1, 1) },
        uBgOpacity: { value: 1 },
        uTextColor: { value: new THREE.Vector3(0, 0, 0) },
        uBorderOpacity: { value: 0.18 },
        uTintRest: { value: 0.15 },
        uTintHover: { value: 0.45 },
        uHighlightColor: { value: new THREE.Vector3(1, 0.72, 0) },
      },
      transparent: true,
      // fork fix (flicker): no depth writes among labels. Overlapping cards
      // at nearly the same depth (always in 2D mode, where everything sits
      // in z = 0) z-fought: which card won flipped from frame to frame as
      // the nodes moved. The cards are drawn sorted far → near instead
      // (updateVisibilityAndOcclusion), so a nearer card still covers a
      // farther one, deterministically; nodes still hide labels behind them.
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.setStyle(this.style ?? labelStyleFrom(settings, settings.colorHighlight));

    this.instancedMesh = new THREE.Mesh(this.instancedGeo, this.material);
    this.instancedMesh.frustumCulled = false;
    this.instancedMesh.renderOrder = 999;
    this.scene.add(this.instancedMesh);
  }

  /** fork: copy the per-label data into the draw slots (current order) */
  private writeSlots() {
    if (!this.translationAttr || !this.scaleAttr || !this.uvAttr || !this.opacityAttr || !this.highlightAttr || !this.colorAttr) return;
    const tr = this.translationAttr.array as Float32Array, sc = this.scaleAttr.array as Float32Array;
    const uv = this.uvAttr.array as Float32Array, op = this.opacityAttr.array as Float32Array;
    const hl = this.highlightAttr.array as Float32Array, co = this.colorAttr.array as Float32Array;
    for (let s = 0; s < this.visibleCount; s++) {
      const i = this.slotLabel[s];
      tr[s * 3] = this.labelTrans[i * 3]; tr[s * 3 + 1] = this.labelTrans[i * 3 + 1]; tr[s * 3 + 2] = this.labelTrans[i * 3 + 2];
      sc[s * 2] = this.labelScale[i * 2]; sc[s * 2 + 1] = this.labelScale[i * 2 + 1];
      for (let k = 0; k < 4; k++) { uv[s * 4 + k] = this.labelUV[i * 4 + k]; co[s * 4 + k] = this.labelColor[i * 4 + k]; }
      op[s] = this.labelOpacity[i];
      hl[s] = this.labelHighlight[i];
    }
    for (const a of [this.translationAttr, this.scaleAttr, this.uvAttr, this.opacityAttr, this.highlightAttr, this.colorAttr]) a.needsUpdate = true;
    if (this.instancedGeo) this.instancedGeo.instanceCount = this.visibleCount;
  }

  public updateVisibilityAndOcclusion(
    camera: THREE.Camera,
    positions: Float32Array,
    settings: Graph3DPluginSettings,
    hoveredNodeId: string | null = null,
    highlightedNodeIds: Set<string> = new Set(),
  ): void {
    if (
      !this.opacityAttr ||
      !this.translationAttr ||
      this.labelCount === 0 ||
      !settings.showNodeLabels ||
      settings.performanceMode
    ) {
      if (this.instancedMesh) this.instancedMesh.visible = false;
      return;
    }

    if (this.instancedMesh) this.instancedMesh.visible = true;

    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    const trans = this.labelTrans;
    const opacities = this.labelOpacity;
    const stride = this.positionsStride;

    const visibleDistance = settings.labelDistance;
    const fadeStartDistance = visibleDistance * settings.labelFadeThreshold;
    const visibleDistSq = visibleDistance * visibleDistance;
    const fadeStartDistSq = fadeStartDistance * fadeStartDistance;

    const camPos = camera.position;
    const checkOcclusion = settings.labelOcclusion;
    const hoverOnly = settings.showLabelsOnHoverOnly;

    // First pass: update positions and compute distance fade
    for (let i = 0; i < this.labelCount; i++) {
      const src = i * stride;
      const dst = i * 3;
      const label = this.labels[i];

      if (this.suppressed && this.suppressed[i]) { // fork: thumbnail node without a label
        opacities[i] = 0.0;
        continue;
      }

      const x = positions[src];
      const y = positions[src + 1] + label.size * 0.6 + 2.0 + (label.lift || 0) + (this.extraLift ? this.extraLift[i] : 0); // Place above node
      const z = positions[src + 2];

      trans[dst] = x;
      trans[dst + 1] = y;
      trans[dst + 2] = z;

      if (hoverOnly) {
        const isHovered = hoveredNodeId !== null && label.id === hoveredNodeId;
        const isHighlighted = highlightedNodeIds.has(label.id);
        if (!isHovered && !isHighlighted) {
          opacities[i] = 0.0;
          continue;
        }
      }

      this.tempNodePos.set(x, y, z);

      if (!this.frustum.containsPoint(this.tempNodePos)) {
        opacities[i] = 0.0;
        continue;
      }

      const distSq = camPos.distanceToSquared(this.tempNodePos);
      this.labelDistSq[i] = distSq;
      if (distSq > visibleDistSq) {
        opacities[i] = 0.0;
        continue;
      }

      let opacity = 1.0;
      if (distSq > fadeStartDistSq) {
        const dist = Math.sqrt(distSq);
        opacity = 1.0 - (dist - fadeStartDistance) / (visibleDistance - fadeStartDistance);
      }

      // Fast analytical ray-sphere occlusion (Item 3)
      if (opacity > 0.01 && checkOcclusion) {
        const rayDir = this.tempCamToNode.subVectors(this.tempNodePos, camPos).normalize();
        const maxDist = Math.sqrt(distSq);

        let occluded = false;
        // Test against candidate nodes
        for (let j = 0; j < this.labelCount; j++) {
          if (j === i) continue;
          const otherSrc = j * stride;
          const ox = positions[otherSrc] - camPos.x;
          const oy = positions[otherSrc + 1] - camPos.y;
          const oz = positions[otherSrc + 2] - camPos.z;

          // Projection along ray
          const dot = ox * rayDir.x + oy * rayDir.y + oz * rayDir.z;
          if (dot <= 1.0 || dot >= maxDist - 1.0) continue;

          // Perpendicular distance squared
          const oDistSq = ox * ox + oy * oy + oz * oz;
          const perpDistSq = oDistSq - dot * dot;
          const nodeRadius = this.labels[j].size;

          if (perpDistSq <= nodeRadius * nodeRadius) {
            occluded = true;
            break;
          }
        }

        if (occluded) {
          opacity = 0.0;
        }
      }

      opacities[i] = opacity;
    }

    // fork: draw order — only the visible labels, farthest first, highlighted
    // ones last (on top). Replaces depth writes between labels (see material).
    let count = 0;
    for (let i = 0; i < this.labelCount; i++) if (opacities[i] >= 0.005) this.slotLabel[count++] = i;
    const order = this.slotLabel.subarray(0, count);
    const hl = this.labelHighlight, dist = this.labelDistSq;
    order.sort((a, b) => (hl[a] - hl[b]) || (dist[b] - dist[a]) || (a - b));
    this.visibleCount = count;
    this.writeSlots();
  }

  /** fork: label boxes for the layout's separation pass — per label (= node
   *  index) [width, height, centre height above its node], world units */
  public labelBoxes(): Float32Array {
    const n = this.labelCount;
    if (this.labelBoxCache.length !== n * 3) this.labelBoxCache = new Float32Array(n * 3);
    const b = this.labelBoxCache;
    for (let i = 0; i < n; i++) {
      const label = this.labels[i];
      b[i * 3] = this.labelScale[i * 2];
      b[i * 3 + 1] = this.labelScale[i * 2 + 1];
      b[i * 3 + 2] = label.size * 0.6 + 2.0 + (label.lift || 0); // as in updateVisibilityAndOcclusion
      const o = this.boxOverride;
      if (o && o.length >= n * 3 && o[i * 3] > 0) { // fork: a thumbnail's box
        b[i * 3] = o[i * 3]; b[i * 3 + 1] = o[i * 3 + 1]; b[i * 3 + 2] = o[i * 3 + 2];
      }
    }
    return b;
  }

  public clear(): void {
    if (this.instancedMesh) {
      this.scene.remove(this.instancedMesh);
      this.instancedGeo?.dispose();
      this.material?.dispose();
      this.instancedMesh = null;
      this.instancedGeo = null;
      this.translationAttr = null;
      this.scaleAttr = null;
      this.uvAttr = null;
      this.opacityAttr = null;
      this.highlightAttr = null;
      this.colorAttr = null;
      this.material = null;
    }
    if (this.atlasTexture) {
      this.atlasTexture.dispose();
      this.atlasTexture = null;
    }
    this.labelCache.clear();
    this.labels = [];
    this.labelCount = 0;
    this.visibleCount = 0;
    this.suppressed = null;
    this.boxOverride = null;
    this.extraLift = null;
  }
}
