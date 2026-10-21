// fork: the docked preview — a panel fixed in the graph view's lower-right corner that follows
// the pointer over the nodes (≈80 ms debounce) and keeps showing the last hovered note when the
// pointer leaves. A scan shows as the picture + one line; any other note is rendered with
// MarkdownRenderer (no properties block). Header: pin (freeze), collapse. Resizable by the grip in
// the upper-left corner; the default is 500×680, never more than 45 % of the view's width or 80 % of
// its height (re-clamped when the view resizes); the size is saved. Clicking the body activates it.
import { type App, Component, MarkdownRenderer, setIcon, TFile } from "obsidian";
import * as A from "../fork/analog";

export type DockContent =
  | { kind: "scan"; id: string; title: string; imageUrl: string; line: string }
  | { kind: "note"; id: string; title: string; path: string };

export interface DockHost {
  size(): { w: number; h: number };
  saveSize(w: number, h: number): void;
  collapsed(): boolean;
  setCollapsed(c: boolean): void;
  /** the body was clicked: enlarge the scan or open the note */
  activate(content: DockContent): void;
}

const DEBOUNCE_MS = 80;
const MAX_NOTE_CHARS = 8000;

export class DockedPreview {
  private el: HTMLDivElement;
  private titleEl: HTMLSpanElement;
  private body: HTMLDivElement;
  private pinBtn: HTMLButtonElement;
  private collapseBtn: HTMLButtonElement;
  private pinned = false;
  private shown: DockContent | null = null;
  private shownKey = "";
  private timer: number | null = null;
  private token = 0;
  private md: Component | null = null;
  private ro: ResizeObserver;

  constructor(private readonly parent: HTMLElement, private readonly app: App, private readonly host: DockHost) {
    this.el = parent.createDiv({ cls: "graph-3d-dock" });
    this.el.style.display = "none";
    const grip = this.el.createDiv({ cls: "graph-3d-dock-grip", attr: { "aria-label": "Ändra storlek" } });
    const head = this.el.createDiv({ cls: "graph-3d-dock-head" });
    this.titleEl = head.createSpan({ cls: "graph-3d-dock-title", text: "Förhandsvisning" });
    this.pinBtn = head.createEl("button", { cls: "graph-3d-dock-btn", attr: { "aria-label": "Fäst på den här anteckningen" } });
    setIcon(this.pinBtn, "pin");
    this.pinBtn.addEventListener("click", () => this.setPinned(!this.pinned));
    this.collapseBtn = head.createEl("button", { cls: "graph-3d-dock-btn" });
    this.collapseBtn.addEventListener("click", () => this.setCollapsed(!this.host.collapsed()));
    this.body = this.el.createDiv({ cls: "graph-3d-dock-body" });
    this.body.addEventListener("click", () => { if (this.shown) this.host.activate(this.shown); });

    // resize: dragging the upper-left grip left/up grows the panel (it is anchored lower right)
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const start = this.currentSize(), x0 = e.clientX, y0 = e.clientY;
      const move = (ev: PointerEvent) => {
        const r = this.parent.getBoundingClientRect();
        const s = A.dockSizeFromDrag(start, ev.clientX - x0, ev.clientY - y0, r.width, r.height, this.reservedTop());
        this.applySize(s.w, s.h);
      };
      const up = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        const s = this.currentSize();
        this.host.saveSize(s.w, s.h);
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
    });

    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(parent);
    // the switch panel (top right) is never covered: the room below it limits the height, and the
    // panel folding / unfolding re-fits the dock
    const panel = parent.querySelector(".graph-3d-switch-panel");
    if (panel) this.ro.observe(panel);
    this.layout();
  }

  /** show or hide the whole panel (mode docked on/off) */
  setVisible(v: boolean) {
    this.parent.toggleClass("graph-3d-docked", v); // the switch panel then leaves room below it (styles.css)
    if (v) { this.el.style.display = ""; this.layout(); } else this.el.style.display = "none";
  }

  /** ask to show a note (debounced; ignored while pinned or when it is already shown) */
  request(content: DockContent) {
    if (this.pinned) return;
    if (this.keyOf(content) === this.shownKey) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = null; void this.render(content); }, DEBOUNCE_MS);
  }

  destroy() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.ro.disconnect();
    this.md?.unload();
    this.el.remove();
  }

  // ---- internals ----

  private keyOf(c: DockContent) { return `${c.kind}:${c.id}`; }

  private setPinned(p: boolean) {
    this.pinned = p;
    this.el.toggleClass("is-pinned", p);
    this.pinBtn.setAttribute("aria-label", p ? "Lossa" : "Fäst på den här anteckningen");
  }

  private setCollapsed(c: boolean) {
    this.host.setCollapsed(c);
    this.layout();
  }

  private currentSize() {
    return { w: this.el.offsetWidth, h: this.el.offsetHeight };
  }

  private applySize(w: number, h: number) {
    this.el.style.width = `${w}px`;
    this.el.style.height = `${h}px`;
  }

  /** px from the view's top that the dock must stay below: the switch panel's bottom edge + 8 */
  private reservedTop(): number {
    const panel = this.parent.querySelector(".graph-3d-switch-panel") as HTMLElement | null;
    if (!panel || panel.offsetParent === null) return 0;
    return panel.getBoundingClientRect().bottom - this.parent.getBoundingClientRect().top + 8;
  }

  /** the saved size clamped to the view now; collapsed = header only */
  private layout() {
    const r = this.parent.getBoundingClientRect();
    const want = this.host.size();
    const s = A.clampDockSize(want.w, want.h, r.width, r.height, this.reservedTop());
    const collapsed = this.host.collapsed();
    this.el.style.width = `${s.w}px`;
    this.el.style.height = collapsed ? "" : `${s.h}px`;
    this.el.toggleClass("is-collapsed", collapsed);
    setIcon(this.collapseBtn, collapsed ? "chevron-up" : "chevron-down");
    this.collapseBtn.setAttribute("aria-label", collapsed ? "Fäll ut" : "Fäll ihop");
  }

  private async render(c: DockContent) {
    const token = ++this.token;
    this.md?.unload();
    this.md = null;
    this.shown = c;
    this.shownKey = this.keyOf(c);
    this.titleEl.setText(c.title);
    this.body.empty();
    if (c.kind === "scan") {
      const box = this.body.createDiv({ cls: "graph-3d-dock-scan" });
      box.createEl("img", { attr: { src: c.imageUrl, alt: "", draggable: "false" } });
      this.body.createDiv({ cls: "graph-3d-dock-line", text: c.line });
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(c.path);
    if (!(file instanceof TFile)) return;
    let text = await this.app.vault.cachedRead(file);
    if (token !== this.token) return;
    text = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""); // properties are not shown
    if (text.length > MAX_NOTE_CHARS) text = text.slice(0, MAX_NOTE_CHARS) + "\n\n…";
    const holder = this.body.createDiv({ cls: "graph-3d-dock-note markdown-preview-view markdown-rendered graph-3d-hide-properties" });
    this.md = new Component();
    this.md.load();
    await MarkdownRenderer.render(this.app, text, holder, c.path, this.md);
  }
}
