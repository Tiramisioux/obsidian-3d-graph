// fork: the enlarge lightbox over the graph view (WP-G). The full scan fitted into the view;
// wheel = zoom around the cursor, drag = pan, ←/→ = previous/next in timeline order, Esc or a
// click outside the picture closes, "Öppna anteckning" opens the note. Maths: src/fork/analog.js.
import { setIcon } from "obsidian";
import * as A from "../fork/analog";

export interface LightboxItem {
  id: string;
  imageUrl: string;
  /** one line: date · collection · page */
  caption: string;
}

export interface LightboxHost {
  /** ids in timeline order (the ←/→ order) */
  ids(): string[];
  resolve(id: string): LightboxItem | null;
  openNote(id: string): void;
  /** called when the shown item changes (the graph can follow it) */
  onShow?(id: string): void;
}

export class Lightbox {
  private root: HTMLDivElement;
  private stage: HTMLDivElement;
  private img: HTMLImageElement;
  private captionEl: HTMLSpanElement;
  private current: string | null = null;
  private st: A.ViewState = { s: 1, x: 0, y: 0 };
  private fit = 1;
  private iw = 0;
  private ih = 0;
  private ro: ResizeObserver;

  constructor(parent: HTMLElement, private readonly host: LightboxHost) {
    this.root = parent.createDiv({ cls: "graph-3d-lightbox", attr: { tabindex: "-1" } });
    this.root.style.display = "none";
    this.stage = this.root.createDiv({ cls: "graph-3d-lightbox-stage" });
    this.img = this.stage.createEl("img", { cls: "graph-3d-lightbox-img", attr: { draggable: "false", alt: "" } });

    const bar = this.root.createDiv({ cls: "graph-3d-lightbox-bar" });
    this.captionEl = bar.createSpan({ cls: "graph-3d-lightbox-caption" });
    const openBtn = bar.createEl("button", { cls: "mod-cta", text: "Öppna anteckning" });
    openBtn.addEventListener("click", () => { if (this.current) this.host.openNote(this.current); });
    const closeBtn = bar.createEl("button", { cls: "graph-3d-lightbox-close", attr: { "aria-label": "Stäng (Esc)" } });
    setIcon(closeBtn, "x");
    closeBtn.addEventListener("click", () => this.close());
    for (const [dir, cls, icon] of [[-1, "is-prev", "chevron-left"], [1, "is-next", "chevron-right"]] as const) {
      const b = this.root.createEl("button", { cls: `graph-3d-lightbox-nav ${cls}`, attr: { "aria-label": dir < 0 ? "Föregående (←)" : "Nästa (→)" } });
      setIcon(b, icon);
      b.addEventListener("click", () => this.step(dir));
    }

    this.img.addEventListener("load", () => {
      this.iw = this.img.naturalWidth;
      this.ih = this.img.naturalHeight;
      this.refit();
    });
    this.img.addEventListener("dblclick", () => this.refit());

    this.stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (!this.iw) return;
      const r = this.stage.getBoundingClientRect();
      // pinch on a trackpad arrives as ctrl+wheel with small deltas
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      this.st = A.clampPan(A.zoomAt(this.st, factor, e.clientX - r.left, e.clientY - r.top, this.fit), this.iw, this.ih, r.width, r.height);
      this.apply();
    }, { passive: false });

    let drag: { x: number; y: number; sx: number; sy: number; moved: boolean } | null = null;
    this.stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, sx: this.st.x, sy: this.st.y, moved: false };
      this.stage.setPointerCapture(e.pointerId);
    });
    this.stage.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      const r = this.stage.getBoundingClientRect();
      this.st = A.clampPan({ s: this.st.s, x: drag.sx + dx, y: drag.sy + dy }, this.iw, this.ih, r.width, r.height);
      this.apply();
    });
    this.stage.addEventListener("pointerup", (e) => {
      const d = drag;
      drag = null;
      if (!d || d.moved) return;
      // a click that did not hit the picture closes
      const r = this.stage.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const inside = px >= this.st.x && px <= this.st.x + this.iw * this.st.s && py >= this.st.y && py <= this.st.y + this.ih * this.st.s;
      if (!inside) this.close();
    });

    this.root.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") this.close();
      else if (e.key === "ArrowLeft") this.step(-1);
      else if (e.key === "ArrowRight") this.step(1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });

    this.ro = new ResizeObserver(() => {
      if (!this.iw || !this.isOpen) return;
      const r = this.stage.getBoundingClientRect();
      const wasFit = Math.abs(this.st.s - this.fit) < 1e-6;
      this.fit = A.fitScale(this.iw, this.ih, r.width, r.height);
      if (wasFit) this.refit();
      else { this.st = A.clampPan(this.st, this.iw, this.ih, r.width, r.height); this.apply(); }
    });
    this.ro.observe(this.stage);
  }

  get isOpen(): boolean { return this.current !== null; }
  get currentId(): string | null { return this.current; }

  open(id: string) {
    if (!this.show(id)) return;
    this.root.style.display = "";
    this.root.focus();
  }

  close() {
    this.current = null;
    this.root.style.display = "none";
    this.img.removeAttribute("src");
    this.iw = this.ih = 0;
  }

  destroy() {
    this.ro.disconnect();
    this.root.remove();
  }

  private show(id: string): boolean {
    const item = this.host.resolve(id);
    if (!item) return false;
    this.current = id;
    this.iw = this.ih = 0; // wait for the picture
    this.captionEl.setText(item.caption);
    this.img.src = item.imageUrl;
    this.host.onShow?.(id);
    return true;
  }

  private step(delta: number) {
    if (!this.current) return;
    const next = A.neighbourId(this.host.ids(), this.current, delta);
    if (next) this.show(next);
  }

  private refit() {
    const r = this.stage.getBoundingClientRect();
    if (!this.iw || !r.width) return;
    this.fit = A.fitScale(this.iw, this.ih, r.width, r.height);
    this.st = A.fitState(this.iw, this.ih, r.width, r.height);
    this.apply();
  }

  private apply() {
    this.img.style.transform = `translate(${this.st.x}px, ${this.st.y}px) scale(${this.st.s})`;
  }
}
