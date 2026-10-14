import { setIcon } from "obsidian";

/**
 * fork: a small in-view panel of flip switches (Obsidian's own
 * `.checkbox-container` toggle) and segmented switches. Each control reads
 * its state through `get()` on every `refresh()`, so whatever changes a
 * setting — the switch, a command/hotkey, the settings tab — only has to call
 * `refresh()` and every switch shows the live state.
 *
 * Adding a switch is one call:
 *   panel.addSwitch({ label: "Labels", get: () => s.showNodeLabels, set: (v) => … });
 */

/** fork: a control's label — fixed, or re-read on every refresh */
export type Label = string | (() => string);
const labelText = (l: Label) => (typeof l === "function" ? l() : l);

export interface FlipSwitchSpec {
  label: Label;
  get: () => boolean;
  set: (value: boolean) => unknown | Promise<unknown>;
  /** tooltip text (the hotkey hint is appended) */
  tooltip?: string;
  /** command id (without the plugin prefix) whose hotkey goes in the tooltip */
  commandId?: string;
  /** greyed out (still shows its state) */
  disabled?: () => boolean;
}

export interface SegmentedSwitchSpec<T extends string> {
  label: Label;
  options: { value: T; label: string; tooltip?: string }[];
  get: () => T;
  set: (value: T) => unknown | Promise<unknown>;
  tooltip?: string;
  commandId?: string;
  disabled?: () => boolean;
}

export interface SliderSpec {
  label: Label;
  min: number;
  max: number;
  step: number;
  get: () => number;
  /** while dragging — a live preview, nothing saved */
  preview?: (value: number) => unknown;
  /** on release — keep the value */
  set: (value: number) => unknown | Promise<unknown>;
  format?: (value: number) => string;
  tooltip?: string;
  commandId?: string;
  disabled?: () => boolean;
}

export interface SwitchPanelOptions {
  title: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => unknown;
  /** " · ⌥⌘G" for a command id, or "" */
  hotkeyHint: (commandId: string) => string;
}

interface Control {
  refresh: () => void;
}

export class SwitchPanel {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private header: HTMLElement;
  private chevron: HTMLElement;
  private controls: Control[] = [];
  private collapsed: boolean;

  constructor(parent: HTMLElement, private opts: SwitchPanelOptions) {
    this.collapsed = opts.collapsed;
    this.el = parent.createDiv({ cls: "graph-3d-switch-panel" });
    this.header = this.el.createDiv({ cls: "graph-3d-switch-header", attr: { role: "button", tabindex: "0" } });
    this.chevron = this.header.createSpan({ cls: "graph-3d-switch-chevron" });
    this.header.createSpan({ cls: "graph-3d-switch-title", text: opts.title });
    this.body = this.el.createDiv({ cls: "graph-3d-switch-body" });
    const toggle = () => this.setCollapsed(!this.collapsed, true);
    this.header.addEventListener("click", toggle);
    this.header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
    // keep pointer/keyboard events away from the graph underneath
    for (const ev of ["pointerdown", "pointermove", "wheel", "dblclick", "click", "keydown"]) {
      this.el.addEventListener(ev, (e) => e.stopPropagation());
    }
    this.applyCollapsed();
  }

  setCollapsed(collapsed: boolean, notify = false) {
    this.collapsed = collapsed;
    this.applyCollapsed();
    if (notify) this.opts.onCollapsedChange(collapsed);
  }

  private applyCollapsed() {
    this.el.toggleClass("is-collapsed", this.collapsed);
    this.chevron.empty();
    setIcon(this.chevron, this.collapsed ? "chevron-right" : "chevron-down");
    this.header.setAttribute("aria-label", this.collapsed ? "Show switches" : "Hide switches");
    this.header.setAttribute("aria-expanded", String(!this.collapsed));
  }

  addHeading(text: string) {
    this.body.createDiv({ cls: "graph-3d-switch-heading", text });
  }

  private tooltipFor(spec: { label: Label; tooltip?: string; commandId?: string }) {
    return (spec.tooltip ?? labelText(spec.label)) + (spec.commandId ? this.opts.hotkeyHint(spec.commandId) : "");
  }

  addSwitch(spec: FlipSwitchSpec) {
    const row = this.body.createDiv({ cls: "graph-3d-switch-row" });
    const label = row.createSpan({ cls: "graph-3d-switch-label" });
    // Obsidian's native toggle: div.checkbox-container(.is-enabled) > input
    const box = row.createDiv({ cls: "checkbox-container graph-3d-flip", attr: { role: "switch", tabindex: "0" } });
    const input = box.createEl("input", { attr: { type: "checkbox", tabindex: "-1" } });
    let busy = false;
    const flip = async () => {
      if (busy || spec.disabled?.()) return;
      busy = true;
      try {
        await spec.set(!spec.get());
      } finally {
        busy = false;
        this.refresh();
      }
    };
    row.addEventListener("click", (e) => { e.preventDefault(); flip(); });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); }
    });
    const refresh = () => {
      const on = spec.get();
      const disabled = !!spec.disabled?.();
      box.toggleClass("is-enabled", on);
      input.checked = on;
      box.setAttribute("aria-checked", String(on));
      label.setText(labelText(spec.label));
      row.toggleClass("is-disabled", disabled);
      row.setAttribute("aria-label", this.tooltipFor(spec));
    };
    this.controls.push({ refresh });
    refresh();
  }

  addSegmented<T extends string>(spec: SegmentedSwitchSpec<T>) {
    const row = this.body.createDiv({ cls: "graph-3d-switch-row graph-3d-switch-row-segmented" });
    const label = row.createSpan({ cls: "graph-3d-switch-label" });
    const group = row.createDiv({ cls: "graph-3d-segmented", attr: { role: "radiogroup" } });
    const buttons = spec.options.map((o) => {
      const b = group.createEl("button", { cls: "graph-3d-segment", text: o.label, attr: { role: "radio" } });
      if (o.tooltip) b.setAttribute("aria-label", o.tooltip);
      b.addEventListener("click", async (e) => {
        e.preventDefault();
        if (spec.disabled?.() || spec.get() === o.value) return;
        await spec.set(o.value);
        this.refresh();
      });
      return { b, o };
    });
    const refresh = () => {
      const cur = spec.get();
      const disabled = !!spec.disabled?.();
      for (const { b, o } of buttons) {
        b.toggleClass("is-active", o.value === cur);
        b.setAttribute("aria-checked", String(o.value === cur));
        b.disabled = disabled;
      }
      label.setText(labelText(spec.label));
      row.toggleClass("is-disabled", disabled);
      row.setAttribute("aria-label", this.tooltipFor(spec));
    };
    this.controls.push({ refresh });
    refresh();
  }

  /** a labelled slider (Obsidian's own `.slider` look) with its value
   *  shown; `preview` while dragging, `set` on release */
  addSlider(spec: SliderSpec) {
    const row = this.body.createDiv({ cls: "graph-3d-switch-row graph-3d-switch-row-slider" });
    const head = row.createDiv({ cls: "graph-3d-switch-slider-head" });
    const label = head.createSpan({ cls: "graph-3d-switch-label" });
    const value = head.createSpan({ cls: "graph-3d-switch-value" });
    const input = row.createEl("input", {
      cls: "slider graph-3d-slider",
      attr: { type: "range", min: String(spec.min), max: String(spec.max), step: String(spec.step), "data-ignore-swipe": "true" },
    });
    const fmt = (v: number) => (spec.format ? spec.format(v) : String(v));
    // Obsidian's slider CSS draws the filled part of the track from this
    // variable (its SliderComponent sets it the same way)
    const fill = (v: number) =>
      input.style.setProperty("--slider-fill-ratio", String((v - spec.min) / (spec.max - spec.min || 1)));
    let dragging = false;
    input.addEventListener("input", () => {
      dragging = true;
      const v = Number(input.value);
      value.setText(fmt(v));
      fill(v);
      spec.preview?.(v);
    });
    input.addEventListener("change", async () => {
      try {
        await spec.set(Number(input.value));
      } finally {
        dragging = false;
        this.refresh();
      }
    });
    const refresh = () => {
      const disabled = !!spec.disabled?.();
      input.disabled = disabled;
      label.setText(labelText(spec.label));
      row.toggleClass("is-disabled", disabled);
      row.setAttribute("aria-label", this.tooltipFor(spec));
      if (dragging) return;
      const v = spec.get();
      input.value = String(v);
      value.setText(fmt(v));
      fill(v);
    };
    this.controls.push({ refresh });
    refresh();
  }

  /** re-read every control's state (after any settings change) */
  refresh() {
    for (const c of this.controls) c.refresh();
  }
}
