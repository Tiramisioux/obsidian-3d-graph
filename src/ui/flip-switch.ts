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

export interface FlipSwitchSpec {
  label: string;
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
  label: string;
  options: { value: T; label: string; tooltip?: string }[];
  get: () => T;
  set: (value: T) => unknown | Promise<unknown>;
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

  private tooltipFor(spec: { label: string; tooltip?: string; commandId?: string }) {
    return (spec.tooltip ?? spec.label) + (spec.commandId ? this.opts.hotkeyHint(spec.commandId) : "");
  }

  addSwitch(spec: FlipSwitchSpec) {
    const row = this.body.createDiv({ cls: "graph-3d-switch-row" });
    row.createSpan({ cls: "graph-3d-switch-label", text: spec.label });
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
      row.toggleClass("is-disabled", disabled);
      row.setAttribute("aria-label", this.tooltipFor(spec));
    };
    this.controls.push({ refresh });
    refresh();
  }

  addSegmented<T extends string>(spec: SegmentedSwitchSpec<T>) {
    const row = this.body.createDiv({ cls: "graph-3d-switch-row graph-3d-switch-row-segmented" });
    row.createSpan({ cls: "graph-3d-switch-label", text: spec.label });
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
      row.toggleClass("is-disabled", disabled);
      row.setAttribute("aria-label", this.tooltipFor(spec));
    };
    this.controls.push({ refresh });
    refresh();
  }

  /** re-read every control's state (after any settings change) */
  refresh() {
    for (const c of this.controls) c.refresh();
  }
}
