import ForceGraph3D from "3d-force-graph";
import {
  debounce,
  getAllTags,
  ItemView,
  Setting,
  setIcon,
  TFile,
  type WorkspaceLeaf,
} from "obsidian";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import type Graph3DPlugin from "../main";
import { PhysicsBridge } from "./physics/physics-bridge";
import { createWorkerBlobUrl, getWasmArrayBuffer } from "./physics/wasm-loader";
import { InstancedGraphRenderer } from "./rendering/graph-renderer";
import { colorToRgb01, InstancedLabelRenderer, labelStyleFrom } from "./rendering/label-renderer";
import { SwitchPanel } from "./ui/flip-switch";
import {
  ColorGroup,
  type Filter,
  type Graph3DPluginSettings,
  type GraphLink,
  type GraphNode,
  NodeShape,
  NodeType,
} from "./types";

export const VIEW_TYPE_3D_GRAPH = "3d-graph-view";

/** fork: a + (b − a)·t as "#rrggbb" (inputs "#hex" or "rgb(…)") */
function mixColors(a: string, b: string, t: number): string {
  const x = colorToRgb01(a), y = colorToRgb01(b);
  const ch = (k: number) => Math.round((x[k] + (y[k] - x[k]) * t) * 255).toString(16).padStart(2, "0");
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

interface ProcessedGraphLink {
  source: GraphNode;
  target: GraphNode;
}

interface PreprocessedGroup {
  color: string;
  query: string;
  type: "path" | "tag" | "file" | "text" | "prop" | "name";
  pathQuery?: string;
  tagQuery?: string;
  fileQuery?: string;
  fileRegex?: RegExp;
  /** fork: `prop: key=a|b` — frontmatter key (lower case) and accepted values */
  propKey?: string;
  propValues?: string[];
  /** fork: `name: <regex>` on the node's name */
  nameRegex?: RegExp;
}

/** fork: the project tags a note names in frontmatter — `projekt` and
 *  `delprojekt`, string or list, leading `#` stripped ("#STOPP" → "STOPP") */
function projectTagsOf(fm: Record<string, unknown> | undefined): string[] {
  if (!fm) return [];
  const out: string[] = [];
  for (const key of Object.keys(fm)) {
    const k = key.toLowerCase();
    if (k !== "projekt" && k !== "delprojekt") continue;
    const raw = fm[key];
    for (const v of Array.isArray(raw) ? raw : [raw]) {
      const t = String(v ?? "").trim().replace(/^#/, "");
      if (t && !/\s/.test(t)) out.push(t);
    }
  }
  return out;
}

/** fork: hex colour as written in a palette note's frontmatter */
const PALETTE_HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export class Graph3DView extends ItemView {
  private graph: any;
  private plugin: Graph3DPlugin;
  private settings: Graph3DPluginSettings;
  private resizeObserver: ResizeObserver;
  private raycaster = new THREE.Raycaster();

  private instancedRenderer: InstancedGraphRenderer | null = null;
  private labelRenderer: InstancedLabelRenderer | null = null;
  private currentPositions: Float32Array = new Float32Array(0);
  private currentNodes: GraphNode[] = [];
  private currentLinks: GraphLink[] = [];
  private nodeIdToIndex = new Map<string, number>();
  private linkToIndex = new Map<GraphLink, number>();

  private reusableNodePosition = new THREE.Vector3();
  private reusableDirection = new THREE.Vector3();
  private cachedOccluders: THREE.Mesh[] = [];
  private occludersCacheDirty = true;
  private readonly RAYCAST_CULL_DISTANCE = 800;

  private nodeMeshes = new WeakMap<GraphNode, THREE.Mesh>();

  private highlightedNodes = new Set<string>();
  private highlightedLinks = new Set<object>();
  private selectedNode: string | null = null;
  private hoveredNode: GraphNode | null = null;

  private colorCache = new Map<string, string>();
  private colorResolverEl: HTMLDivElement | null = null;
  private colorCanvasCtx: CanvasRenderingContext2D | null = null;

  private graphContainer: HTMLDivElement;
  private messageEl: HTMLDivElement;
  private counterEl: HTMLDivElement;
  private settingsPanel: HTMLDivElement;
  private settingsToggleButton: HTMLDivElement;

  private chargeForce: any;
  private centerForce: any;
  private linkForce: any;
  private physicsBridge = new PhysicsBridge();

  private clickTimeout: any = null;
  private isGraphInitialized = false;
  private isUpdating = false;
  private readonly CLICK_DELAY = 250;

  private lastLabelUpdateTime = 0;
  private readonly LABEL_UPDATE_INTERVAL = 100;

  private pressedKeys = new Set<string>();

  private fileContentCache = new Map<
    string,
    { mtime: number; content: string; lowerCaseContent: string }
  >();
  private processedNodes = new Map<string, { node: GraphNode; mtime: number }>();
  private nodeMap = new Map<string, GraphNode>();
  private reciprocalLinks = new Set<string>();
  private linkAdjacencyIndex = new Map<string, ProcessedGraphLink[]>();
  private lastHighlightedNodes = new Set<string>();
  private preprocessedGroups: PreprocessedGroup[] = [];
  private groupsDirty = true;
  /** fork: notes that `palette:` groups read their colours from */
  private paletteSources = new Set<string>();

  private keyboardDirection = new THREE.Vector3();
  private keyboardRight = new THREE.Vector3();
  private keyboardMoveVector = new THREE.Vector3();
  private keyboardNewPos = new THREE.Vector3();
  private keyboardNewTarget = new THREE.Vector3();

  private reusableTargetPosition = new THREE.Vector3();

  private dragSyncBuffer: Float32Array = new Float32Array(0);
  // fork: timeline / storyline
  private timelineTargets: Float32Array = new Float32Array(0); // target y per node, NaN = undated
  private storylineOrder: number[] = []; // node indices, oldest → newest
  private storylineLine: THREE.Line | null = null;
  private timelineGridGroup: THREE.Group | null = null;
  private timelineGridLines: THREE.LineSegments | null = null;
  private timelineGridStops: { y: number; yEnd: number; t0: number; t1: number; sprite: THREE.Object3D }[] = [];
  private timelineGridTick = 0;
  private timelineSyncBuffer: Float32Array = new Float32Array(0);
  // fork: time-grid hover — fitted frame placement, hovered frame, its notes
  private timelineGridFit: { a: number; b: number; cx: number; cz: number; half: number } | null = null;
  private timelineGridFill: THREE.Mesh | null = null;
  private hoveredGridStop: number | null = null;
  private periodNodeIds = new Set<string>();
  private nodeDates: (number | null)[] = [];
  // fork: physics settles → stop stepping (see onPhysicsTick)
  private settleTicks = 0;
  private switchPanel: SwitchPanel | null = null;
  private lastGridUnit: "week" | "month" | "auto" = "auto";
  private timelinePreviewFrame = 0;
  /** fork: date → position on the time axis (grid frames) */
  private timeToAxis: (t: number) => number = () => 0;
  /** fork: ticks since a line layout started easing in */
  private lineRamp = 0;
  /** fork: physics ticks until the camera refits (0 = none pending) */
  private fitAfterTicks = 0;

  private frustum = new THREE.Frustum();
  private projScreenMatrix = new THREE.Matrix4();
  private geometryCache = new Map<NodeShape, THREE.BufferGeometry>();
  private materialCache = new Map<string, THREE.MeshLambertMaterial>();
  private controlsListenerAdded = false;

  constructor(leaf: WorkspaceLeaf, plugin: Graph3DPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.settings = plugin.settings;
  }

  private getSharedGeometry(shape: NodeShape): THREE.BufferGeometry {
    let geometry = this.geometryCache.get(shape);
    if (!geometry) {
      const perf = this.settings.performanceMode;
      switch (shape) {
        case NodeShape.Cube:
          geometry = new THREE.BoxGeometry(1, 1, 1);
          break;
        case NodeShape.Pyramid:
          geometry = new THREE.ConeGeometry(1 / 1.5, 1, perf ? 3 : 4);
          break;
        case NodeShape.Tetrahedron:
          geometry = new THREE.TetrahedronGeometry(1 / 1.2);
          break;
        default:
          geometry = new THREE.SphereGeometry(0.5, perf ? 8 : 16, perf ? 6 : 12);
      }
      this.geometryCache.set(shape, geometry);
    }
    return geometry;
  }

  private getSharedMaterial(color: string): THREE.MeshLambertMaterial {
    let material = this.materialCache.get(color);
    if (!material) {
      material = new THREE.MeshLambertMaterial({
        color: color,
        transparent: true,
        opacity: 0.9,
      });
      this.materialCache.set(color, material);
    }
    return material;
  }

  public clearResourceCaches() {
    this.geometryCache.forEach((g) => g.dispose());
    this.geometryCache.clear();
    this.materialCache.forEach((m) => m.dispose());
    this.materialCache.clear();
  }

  getViewType() {
    return VIEW_TYPE_3D_GRAPH;
  }
  getDisplayText() {
    return "3d graph";
  }

  async onOpen() {
    const rootContainer = this.contentEl;
    rootContainer.empty();
    rootContainer.addClass("graph-3d-view-content");

    const viewWrapper = rootContainer.createEl("div", {
      cls: "graph-3d-view-wrapper",
    });

    this.graphContainer = viewWrapper.createEl("div", {
      cls: "graph-3d-container",
      attr: { tabindex: "0" },
    });
    this.messageEl = viewWrapper.createEl("div", {
      cls: "graph-3d-message",
    });
    this.counterEl = viewWrapper.createEl("div", {
      cls: "graph-3d-counter",
    });

    this.addLocalControls();
    this.initializeGraph();

    const debouncedResize = debounce(
      () => {
        if (this.graph && this.isGraphInitialized) {
          this.graph.width(this.graphContainer.offsetWidth);
          this.graph.height(this.graphContainer.offsetHeight);
        }
      },
      150,
      false,
    );

    this.resizeObserver = new ResizeObserver(() => debouncedResize());
    this.resizeObserver.observe(this.graphContainer);

    this.registerDomEvent(this.graphContainer, "keydown", this.handleKeyDown.bind(this));
    this.registerDomEvent(this.graphContainer, "keyup", this.handleKeyUp.bind(this));
    // fork fix: forget held movement keys when focus leaves the graph/window
    this.registerDomEvent(this.graphContainer, "blur", () => this.pressedKeys.clear());
    this.registerDomEvent(window, "blur", () => this.pressedKeys.clear());

    // fork: a `palette:` group follows its note — edit a colour there and
    // the graph recolours (metadata "changed" fires once the cache is updated)
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (!this.paletteSources.has(file.path)) return;
        this.groupsDirty = true;
        if (this.isGraphInitialized) this.updateColors();
      }),
    );

    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        this.colorCache.clear();
        if (this.isGraphInitialized) {
          this.updateColors();
        }
      }),
    );
  }

  private addLocalControls() {
    const controlsContainer = this.contentEl.createEl("div", {
      cls: "graph-3d-controls-container",
    });

    const resetViewButton = controlsContainer.createEl("div", {
      cls: "graph-3d-reset-toggle",
    });
    setIcon(resetViewButton, "refresh-cw");
    resetViewButton.setAttribute("aria-label", "Reset view (zoom to fit)");
    resetViewButton.addEventListener("click", () => {
      if (this.graph && this.isGraphInitialized) {
        this.fitView(800);
      }
    });

    // fork: the on/off options live in the switch panel (top right, under
    // these buttons) instead
    // of toolbar buttons
    this.buildSwitchPanel();

    this.settingsToggleButton = controlsContainer.createEl("div", {
      cls: "graph-3d-settings-toggle",
    });
    setIcon(this.settingsToggleButton, "settings");
    this.settingsToggleButton.setAttribute("aria-label", "Graph settings");
    this.settingsPanel = controlsContainer.createEl("div", {
      cls: "graph-3d-settings-panel",
    });
    this.settingsToggleButton.addEventListener("click", () => {
      this.settingsPanel.classList.toggle("is-open");
    });
    this.renderSettingsPanel();
  }

  /** fork: the in-view switch panel — every on/off option of the view as a
   *  flip switch, multi-value ones as segmented switches (src/ui/flip-switch.ts) */
  private buildSwitchPanel() {
    const st = this.settings;
    if (st.timelineGrid !== "off") this.lastGridUnit = st.timelineGrid;
    const panel = new SwitchPanel(this.contentEl, {
      title: "Display",
      collapsed: st.switchPanelCollapsed,
      onCollapsedChange: async (c) => { st.switchPanelCollapsed = c; await this.plugin.saveSettings(); },
      hotkeyHint: (id) => this.hotkeyHint(id),
    });
    this.switchPanel = panel;
    const save = async () => { await this.plugin.saveSettings(); };
    const redraw = async () => {
      await this.plugin.saveSettings();
      if (this.isSettingsPanelOpen()) this.renderSettingsPanel();
      await this.updateData({ useCache: true, reheat: true });
    };
    const noTimeline = () => !st.timelineLayout;
    const horiz = () => st.timelineAxis === "horizontal";

    panel.addSegmented({
      label: "Presentation",
      options: [
        { value: "network", label: "Network" },
        { value: "timeline", label: "Timeline" },
        { value: "storyline", label: "Story" },
      ],
      get: () => this.presentationMode(),
      set: (v) => this.setPresentation(v),
      tooltip: "Presentation: network → timeline → timeline + storyline",
      commandId: "cycle-presentation",
    });
    panel.addSwitch({
      label: "2D mode",
      get: () => st.flat2D,
      set: async (v) => { if (v !== st.flat2D) await this.toggleFlat2D(); },
      tooltip: "Flatten into a plane facing you (pan + zoom, no rotation)",
      commandId: "toggle-2d",
    });

    panel.addHeading("Timeline");
    panel.addSwitch({
      label: "Timeline layout",
      get: () => st.timelineLayout,
      set: async (v) => { st.timelineLayout = v; await redraw(); },
      tooltip: "Order notes vertically by date",
    });
    panel.addSegmented({
      label: "Direction",
      options: [
        { value: "vertical", label: "Vertical", tooltip: "Time runs up/down" },
        { value: "horizontal", label: "Horizontal", tooltip: "Time runs left → right" },
      ],
      get: () => st.timelineAxis,
      set: (v) => this.setTimelineForm({ axis: v }),
      tooltip: "Direction of the time axis",
      commandId: "toggle-timeline-direction",
      disabled: noTimeline,
    });
    panel.addSegmented({
      label: "Shape",
      options: [
        { value: "spread", label: "Spread", tooltip: "Notes keep their links' shape across the time axis" },
        { value: "line", label: "Line", tooltip: "Every dated note on one straight line" },
      ],
      get: () => st.timelineShape,
      set: (v) => this.setTimelineForm({ shape: v }),
      tooltip: "Spread across the axis, or one straight line",
      commandId: "toggle-timeline-line",
      disabled: noTimeline,
    });
    panel.addSwitch({
      label: () => (horiz() ? "Newest on the left" : "Newest at the top"),
      get: () => st.timelineNewestTop,
      set: async (v) => { if (v !== st.timelineNewestTop) await this.toggleNewestTop(); },
      tooltip: "Reverse the timeline (newest at the top ↔ bottom)",
      commandId: "toggle-newest-top",
      disabled: noTimeline,
    });
    panel.addSlider({
      label: () => (horiz() ? "Width" : "Height"),
      min: 100,
      max: 3000,
      step: 50,
      get: () => st.timelineLength,
      preview: (v) => this.previewTimelineLength(v),
      set: async (v) => {
        this.previewTimelineLength(v);
        await save();
        if (this.isSettingsPanelOpen()) this.renderSettingsPanel();
      },
      tooltip: "Scale of the time axis: how long the whole date range is (= Timeline length)",
      disabled: noTimeline,
    });
    panel.addSwitch({
      label: "Storyline",
      get: () => st.storyline,
      set: async (v) => { st.storyline = v; await redraw(); },
      tooltip: "A line through the notes in date order",
    });
    panel.addSwitch({
      label: "Time grid",
      get: () => st.timelineGrid !== "off",
      set: async (v) => { st.timelineGrid = v ? this.lastGridUnit : "off"; await redraw(); },
      tooltip: "Week / month frames behind the timeline",
      disabled: noTimeline,
    });
    panel.addSegmented({
      label: "Grid",
      options: [
        { value: "week", label: "Week" },
        { value: "month", label: "Month" },
        { value: "auto", label: "Auto" },
      ],
      get: () => (st.timelineGrid === "off" ? this.lastGridUnit : st.timelineGrid),
      set: async (v) => { this.lastGridUnit = v; st.timelineGrid = v; await redraw(); },
      tooltip: "Time grid unit (auto: weeks up to ~4 months, else months)",
      disabled: () => noTimeline() || st.timelineGrid === "off",
    });
    panel.addSwitch({
      label: "Grid hover",
      get: () => st.timelineGridHover,
      set: async (v) => { st.timelineGridHover = v; if (!v) this.setHoveredGridStop(null); await save(); },
      tooltip: "Hovering a week/month frame lights it and its notes up",
      disabled: () => noTimeline() || st.timelineGrid === "off",
    });

    panel.addHeading("Show");
    panel.addSwitch({
      label: "Labels",
      get: () => st.showNodeLabels,
      set: async (v) => { st.showNodeLabels = v; await save(); this.updateLabels(); },
    });
    panel.addSwitch({
      label: "Project tag",
      get: () => st.showScopeTag,
      set: async (v) => { st.showScopeTag = v; await save(); await this.updateData({ useCache: true, reheat: true }); },
      tooltip: "The node of the tag the graph is filtered on (e.g. #STOPP) — every note links to it",
      disabled: () => !st.showTags || !st.filters.some((f) => f.enabled && f.type === "tag" && f.value.trim() !== ""),
    });
    panel.addSwitch({
      label: "People",
      get: () => st.showPeople,
      set: async (v) => { st.showPeople = v; await save(); await this.updateData({ useCache: true, reheat: true }); },
      tooltip: "Person notes (typ: person) that carry the filtered tag — a person hub carries its projects' tags",
      disabled: () => !st.filters.some((f) => f.enabled && f.type === "tag" && f.value.trim() !== ""),
    });
    panel.addSwitch({
      label: "Events",
      get: () => st.showEvents,
      set: async (v) => { st.showEvents = v; await save(); await this.updateData({ useCache: true }); },
      tooltip: `Dated #${st.eventTag} todos as nodes of their own`,
    });
    panel.addSwitch({
      label: "Page preview",
      get: () => st.hoverPreview,
      set: async (v) => { st.hoverPreview = v; if (!v) this.endHoverPreview(); await save(); },
      tooltip: "Obsidian's page preview when hovering a note",
    });
    panel.addSwitch({
      label: "Trackpad pan",
      get: () => st.trackpadPan,
      set: async (v) => { st.trackpadPan = v; await save(); },
      tooltip: "Two-finger drag pans the view (pinch still zooms)",
    });
  }

  /** fork: after any settings save (switch, command, settings tab, panel):
   *  switches show the live state, and settled physics wakes up again */
  public onSettingsSaved() {
    this.switchPanel?.refresh();
    this.wakePhysics();
  }

  public renderSettingsPanel() {
    this.settingsPanel.empty();
    this.renderSearchSettings(this.settingsPanel);
    this.renderAdvancedFilters(this.settingsPanel);
    this.renderFilterSettings(this.settingsPanel);
    this.renderGroupSettings(this.settingsPanel);
    this.renderAppearanceSettings(this.settingsPanel);
    this.renderLabelSettings(this.settingsPanel);
    this.renderTimelineSettings(this.settingsPanel);
    this.renderInteractionSettings(this.settingsPanel);
    this.renderForceSettings(this.settingsPanel);
  }

  public isSettingsPanelOpen(): boolean {
    return this.settingsPanel?.classList.contains("is-open");
  }

  private renderSearchSettings(container: HTMLElement) {
    new Setting(container).setHeading().setName("Search");
    new Setting(container).setName("Search term").addText((text) =>
      text.setValue(this.settings.searchQuery).onChange(
        debounce(
          async (value) => {
            this.settings.searchQuery = value.trim();
            await this.plugin.saveSettings();
            this.updateData({ useCache: true, reheat: false });
          },
          500,
          true,
        ),
      ),
    );
    new Setting(container)
      .setName("Show neighboring nodes")
      .setDesc("Show nodes linked to search/filter results.")
      .addToggle((toggle) =>
        toggle.setValue(this.settings.showNeighboringNodes).onChange(async (value) => {
          this.settings.showNeighboringNodes = value;
          await this.plugin.saveSettings();
          this.updateData({ useCache: true, reheat: false });
        }),
      );
  }

  private renderAdvancedFilters(container: HTMLElement) {
    new Setting(container).setHeading().setName("Advanced Filters");

    this.settings.filters.forEach((filter, index) => {
      const setting = new Setting(container)
        .addDropdown((dropdown) =>
          dropdown
            .addOption("path", "Path")
            .addOption("tag", "Tag")
            .onChange(async (value: string) => {
              filter.type = value as "path" | "tag";
              await this.plugin.saveSettings();
              this.updateData({ useCache: true });
            }),
        )
        .addText((text) =>
          text
            .setPlaceholder("Enter filter value...")
            .setValue(filter.value)
            .onChange(
              debounce(
                async (value) => {
                  filter.value = value;
                  await this.plugin.saveSettings();
                  this.updateData({ useCache: true });
                },
                500,
                true,
              ),
            ),
        )
        .addToggle((toggle) => {
          toggle
            .setTooltip("Enable/Disable filter")
            .setValue(filter.enabled)
            .onChange(async (value) => {
              filter.enabled = value;
              await this.plugin.saveSettings();
              this.updateData({ useCache: true });
            });
        })
        .addExtraButton((button) =>
          button
            .setIcon("cross")
            .setTooltip("Remove filter")
            .onClick(async () => {
              this.settings.filters.splice(index, 1);
              await this.plugin.saveSettings();
              this.renderSettingsPanel();
              this.updateData({ useCache: true });
            }),
        );
    });

    new Setting(container).addButton((button) =>
      button.setButtonText("Add new filter").onClick(async () => {
        this.settings.filters.push({
          type: "path",
          value: "",
          enabled: true,
        });
        await this.plugin.saveSettings();
        this.renderSettingsPanel();
      }),
    );
  }

  private renderFilterSettings(container: HTMLElement) {
    new Setting(container).setHeading().setName("General Filters");

    new Setting(container).setName("Show tags").addToggle((toggle) =>
      toggle.setValue(this.settings.showTags).onChange(async (value) => {
        this.settings.showTags = value;
        await this.plugin.saveSettings();
        this.updateData({ useCache: true, reheat: false });
      }),
    );

    new Setting(container).setName("Show attachments").addToggle((toggle) =>
      toggle.setValue(this.settings.showAttachments).onChange(async (value) => {
        this.settings.showAttachments = value;
        await this.plugin.saveSettings();
        this.updateData({ useCache: true, reheat: false });
      }),
    );

    new Setting(container).setName("Hide orphans").addToggle((toggle) =>
      toggle.setValue(this.settings.hideOrphans).onChange(async (value) => {
        this.settings.hideOrphans = value;
        await this.plugin.saveSettings();
        this.updateData({ useCache: true, reheat: false });
      }),
    );
  }

  private renderGroupSettings(container: HTMLElement) {
    const groupContainer = container.createDiv();
    const render = () => {
      groupContainer.empty();
      new Setting(groupContainer).setHeading().setName("Color Groups");

      this.settings.groups.forEach((group, index) => {
        new Setting(groupContainer)
          .addText((text) =>
            text
              .setPlaceholder("path:, tag:, file:, or text")
              .setValue(group.query)
              .onChange(async (value) => {
                group.query = value;
                await this.plugin.saveSettings();
                this.updateColors();
              }),
          )
          .addColorPicker((color) =>
            color.setValue(group.color).onChange(async (value) => {
              group.color = value;
              await this.plugin.saveSettings();
              this.updateColors();
            }),
          )
          .addExtraButton((button) =>
            button
              .setIcon("cross")
              .setTooltip("Remove group")
              .onClick(async () => {
                this.settings.groups.splice(index, 1);
                await this.plugin.saveSettings();
                render();
                this.updateColors();
              }),
          );
      });

      new Setting(groupContainer).addButton((button) =>
        button.setButtonText("Add new group").onClick(async () => {
          this.settings.groups.push({ query: "", color: "#ffffff" });
          await this.plugin.saveSettings();
          render();
        }),
      );
    };
    render();
  }

  private renderAppearanceSettings(container: HTMLElement) {
    new Setting(container).setHeading().setName("Appearance");

    const updateDisplayAndColors = async () => {
      await this.plugin.saveSettings();
      this.updateDisplay();
    };

    new Setting(container).setName("Node size").addSlider((s) =>
      s
        .setLimits(0.1, 5, 0.1)
        .setValue(this.settings.nodeSize)
        .setDynamicTooltip()
        .onChange(async (v) => {
          this.settings.nodeSize = v;
          await updateDisplayAndColors();
        }),
    );
    new Setting(container).setName("Tag node size").addSlider((s) =>
      s
        .setLimits(0.1, 5, 0.1)
        .setValue(this.settings.tagNodeSize)
        .setDynamicTooltip()
        .onChange(async (v) => {
          this.settings.tagNodeSize = v;
          await updateDisplayAndColors();
        }),
    );
    new Setting(container).setName("Attachment node size").addSlider((s) =>
      s
        .setLimits(0.1, 5, 0.1)
        .setValue(this.settings.attachmentNodeSize)
        .setDynamicTooltip()
        .onChange(async (v) => {
          this.settings.attachmentNodeSize = v;
          await updateDisplayAndColors();
        }),
    );
    new Setting(container).setName("Link thickness").addSlider((s) =>
      s
        .setLimits(0.1, 5, 0.1)
        .setValue(this.settings.linkThickness)
        .setDynamicTooltip()
        .onChange(async (v) => {
          this.settings.linkThickness = v;
          await updateDisplayAndColors();
        }),
    );

    new Setting(container).setName("Node shape").addDropdown((dd) =>
      dd
        .addOptions(NodeShape)
        .setValue(this.settings.nodeShape)
        .onChange(async (value: string) => {
          this.settings.nodeShape = value as NodeShape;
          await updateDisplayAndColors();
        }),
    );
    new Setting(container).setName("Tag shape").addDropdown((dd) =>
      dd
        .addOptions(NodeShape)
        .setValue(this.settings.tagShape)
        .onChange(async (value: string) => {
          this.settings.tagShape = value as NodeShape;
          await updateDisplayAndColors();
        }),
    );
    new Setting(container).setName("Attachment shape").addDropdown((dd) =>
      dd
        .addOptions(NodeShape)
        .setValue(this.settings.attachmentShape)
        .onChange(async (value: string) => {
          this.settings.attachmentShape = value as NodeShape;
          await updateDisplayAndColors();
        }),
    );
  }

  // ---- fork: timeline layout + storyline ---------------------------------

  /** a note's date: the YYYYMMDDHHmmss file-name prefix, else frontmatter
   *  `datum`/`date`, else the file's creation time; null for tags/unknown */
  private nodeDate(node: GraphNode): number | null {
    if (node.type === NodeType.Event) return node.date ?? null;
    if (node.type !== NodeType.File && node.type !== NodeType.Attachment) return null;
    const base = (node.id.split("/").pop() || "").replace(/\.[^.]+$/, "");
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?(?!\d)/.exec(base);
    if (m) {
      const t = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
      if (!isNaN(t)) return t;
    }
    const file = this.app.vault.getAbstractFileByPath(node.id);
    if (file instanceof TFile) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const raw = fm?.datum ?? fm?.date;
      if (raw) {
        const t = new Date(String(raw).replace(" ", "T")).getTime();
        if (!isNaN(t)) return t;
      }
      return file.stat.ctime;
    }
    return null;
  }

  /** per-node target heights + the chronological order, for the current data */
  private initTimeline(nodes: GraphNode[]) {
    this.clearStoryline();
    const dates = nodes.map((n) => this.nodeDate(n));
    this.nodeDates = dates; // fork: for the time-grid period hover
    const known = dates.filter((d): d is number => d !== null);
    this.timelineTargets = new Float32Array(nodes.length).fill(NaN);
    this.storylineOrder = [];
    if (known.length === 0) return;
    const lo = Math.min(...known), hi = Math.max(...known), span = hi - lo || 1;
    const L = this.settings.timelineLength;
    const sign = this.settings.timelineNewestTop ? 1 : -1; // y up: oldest top by default
    dates.forEach((d, i) => {
      if (d !== null) this.timelineTargets[i] = sign * ((d - lo) / span - 0.5) * L;
    });
    // fork: date → time-axis position, for the grid; a line reshapes it
    this.timeToAxis = (t) => sign * ((t - lo) / span - 0.5) * L;
    this.lineRamp = 0;
    if (this.settings.timelineShape === "line") this.spaceLine(dates, (sign * L) / span);
    this.storylineOrder = dates
      .map((d, i) => [d, i] as [number | null, number])
      .filter(([d, i]) => d !== null && (nodes[i].type === NodeType.File || nodes[i].type === NodeType.Event))
      .sort((a, b) => (a[0] as number) - (b[0] as number))
      .map(([, i]) => i);
    if (this.settings.storyline && this.storylineOrder.length > 1) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.storylineOrder.length * 3), 3));
      const color = this.settings.useThemeColors
        ? this.getCssColor("--interactive-accent", this.settings.colorHighlight)
        : this.settings.colorHighlight;
      const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.75 });
      this.storylineLine = new THREE.Line(geo, mat);
      this.storylineLine.frustumCulled = false;
      this.graph.scene().add(this.storylineLine);
    }
    if (this.settings.timelineLayout && this.settings.timelineGrid !== "off") this.buildTimelineGrid(lo, hi);
  }

  /** faint square frames at each week (Monday) or month start, labelled,
   *  at the height the timeline maps that date to */
  private buildTimelineGrid(lo: number, hi: number) {
    const span = hi - lo || 1;
    const yOf = this.timeToAxis; // fork: on a line, through the spaced notes
    const DAY = 86400000;
    let unit = this.settings.timelineGrid;
    if (unit === "auto") unit = span <= 120 * DAY ? "week" : "month";
    const stops: { t: number; label: string }[] = [];
    if (unit === "week") {
      const d = new Date(lo); d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
      for (; d.getTime() <= hi; d.setDate(d.getDate() + 7)) {
        if (d.getTime() < lo) continue;
        // ISO week number
        const th = new Date(d); th.setDate(th.getDate() + 3);
        const jan4 = new Date(th.getFullYear(), 0, 4);
        const wk = 1 + Math.round(((th.getTime() - jan4.getTime()) / DAY - 3 + ((jan4.getDay() + 6) % 7)) / 7);
        stops.push({ t: d.getTime(), label: `v. ${wk}` });
      }
    } else {
      const d = new Date(lo); d.setHours(0, 0, 0, 0); d.setDate(1);
      if (d.getTime() < lo) d.setMonth(d.getMonth() + 1);
      for (; d.getTime() <= hi; d.setMonth(d.getMonth() + 1))
        stops.push({ t: d.getTime(), label: d.toLocaleDateString("sv-SE", { month: "short", year: "numeric" }) });
    }
    if (!stops.length) return;
    // fork: each frame stands for its period, up to the next frame (the last
    // one up to the newest note)
    const periods = stops.map((s, k) => ({ ...s, t1: k + 1 < stops.length ? stops[k + 1].t : hi + 1 }));
    // unit squares at the TARGET heights; updateTimelineGrid() fits them to
    // where the notes actually are (scale/offset in y, size in x/z)
    const pts: number[] = [];
    for (const s of stops) {
      const y = yOf(s.t);
      const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let i = 0; i < 4; i++) {
        const [x1, z1] = c[i], [x2, z2] = c[(i + 1) % 4];
        pts.push(x1, y, z1, x2, y, z2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const ink = this.getCssColor("--text-faint", "#999999");
    const group = new THREE.Group();
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(ink), transparent: true, opacity: 0.35, depthWrite: false }));
    lines.renderOrder = -1;
    lines.visible = false; // until the first fit
    group.add(lines);
    this.timelineGridLines = lines;
    this.timelineGridStops = [];
    for (const s of periods) {
      const sprite = new SpriteText(s.label, 4, this.getCssColor("--text-muted", "#666666"));
      // fork: beside the frame; on a horizontal timeline centred under it
      if (this.settings.timelineAxis === "horizontal") (sprite as any).center?.set?.(0.5, 1);
      else (sprite as any).center?.set?.(1, 0.5);
      sprite.visible = false;
      group.add(sprite);
      this.timelineGridStops.push({ y: yOf(s.t), yEnd: yOf(Math.min(s.t1, hi)), t0: s.t, t1: s.t1, sprite });
    }
    // fork: faint fill for the hovered frame, in the frame's colour
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(ink), transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
    );
    fill.renderOrder = -1;
    fill.visible = false;
    group.add(fill);
    this.timelineGridFill = fill;
    // fork: the grid is built with time along local y; a horizontal timeline
    // turns it 90° about z (local y → world −x, local x → world y)
    if (this.settings.timelineAxis === "horizontal") group.rotation.z = Math.PI / 2;
    this.timelineGridGroup = group;
    this.graph.scene().add(group);
  }

  /** soft pull of dated nodes towards their height on the time axis, synced
   *  back into the WASM engine on EVERY tick (positions only — it keeps
   *  velocities, the same path node dragging uses). The bridge runs tick
   *  callbacks before it requests the next STEP, so the worker's next step
   *  starts from the nudged positions. Syncing only every few ticks made the
   *  rendered nodes alternate between nudged and un-nudged positions: jitter. */
  private applyTimeline(positions: Float32Array) {
    const timeline = this.settings.timelineLayout && this.timelineTargets.length * 4 <= positions.length;
    const flat = this.settings.flat2D;
    const line = timeline && this.settings.timelineShape === "line";
    // fork: keep labels apart — a line spaces its labels itself
    const separated = line ? false : this.separateLabels(positions);
    if (!timeline && !flat && !separated) return;
    if (timeline) {
      // fork: the time axis is world y (vertical) or world x with the oldest
      // on the left (horizontal) — targets are in "time-axis" units either way
      const horiz = this.settings.timelineAxis === "horizontal";
      // a line eases in over ~30 ticks, then holds every dated note exactly
      // on its spot: one straight line, nothing pulls it out of shape
      const k = line ? Math.min(1, 0.1 + 0.03 * this.lineRamp++) : this.settings.timelineStrength;
      for (let i = 0; i < this.timelineTargets.length; i++) {
        const ty = this.timelineTargets[i];
        if (isNaN(ty)) continue;
        const ia = horiz ? i * 4 : i * 4 + 1; // along the time axis
        const ip = horiz ? i * 4 + 1 : i * 4; // across it, in the view plane
        const cur = horiz ? -positions[ia] : positions[ia];
        const next = cur + (ty - cur) * k;
        positions[ia] = horiz ? -next : next;
        if (line) {
          positions[ip] *= 1 - k;
          positions[i * 4 + 2] *= 1 - k;
        }
      }
    }
    if (flat) {
      // fork 2D mode: everything into the z = 0 plane (soft, so it settles smoothly)
      for (let i = 2; i < positions.length; i += 4) positions[i] *= 0.6;
    }
    if (this.settings.useWasmPhysics) {
      if (this.timelineSyncBuffer.length !== positions.length) this.timelineSyncBuffer = new Float32Array(positions.length);
      this.timelineSyncBuffer.set(positions);
      this.physicsBridge.setPositions(this.timelineSyncBuffer);
    }
  }

  private separationOrder: number[] = [];
  private separationY = new Float32Array(0);

  /** fork: keep labels apart. Notes whose label boxes overlap in the x–y
   *  plane — the plane the timeline and 2D mode are read in — are pushed
   *  apart sideways, half each, by `labelSeparation` of the overlap per tick.
   *  Sideways only, so a note keeps its date. A sweep over the labels sorted
   *  by height compares only neighbours within the tallest label's reach.
   *  Independent of the camera, so the layout doesn't shift as you look
   *  around. Returns whether anything moved. */
  private separateLabels(positions: Float32Array): boolean {
    const k = this.settings.labelSeparation;
    const lr = this.labelRenderer;
    if (!(k > 0) || !lr || !this.settings.showNodeLabels || this.settings.showLabelsOnHoverOnly) return false;
    const box = lr.labelBoxes();
    const n = Math.min(box.length / 3, positions.length / 4);
    if (n < 2) return false;
    // sweep along the time axis (world y, or x on a horizontal timeline) and
    // push across it, so a note keeps its date. Box: [w, h, centre above node]
    const sw = this.settings.timelineLayout && this.settings.timelineAxis === "horizontal" ? 0 : 1;
    const pu = 1 - sw;
    const ext = (i: number, ax: number) => box[i * 3 + ax]; // ax 0 → width, 1 → height
    const off = (i: number, ax: number) => (ax === 1 ? box[i * 3 + 2] : 0);
    if (this.separationY.length !== n) this.separationY = new Float32Array(n);
    const cs = this.separationY, order = this.separationOrder;
    order.length = n;
    let maxE = 0;
    for (let i = 0; i < n; i++) {
      cs[i] = positions[i * 4 + sw] + off(i, sw);
      if (ext(i, sw) > maxE) maxE = ext(i, sw);
      order[i] = i;
    }
    order.sort((a, b) => cs[a] - cs[b]);
    const PAD = 1.5; // world units of air between two cards
    let moved = false;
    for (let a = 0; a < n; a++) {
      const i = order[a];
      for (let b = a + 1; b < n; b++) {
        const j = order[b];
        const ds = cs[j] - cs[i];
        if (ds >= maxE + PAD) break;
        if (ds >= (ext(i, sw) + ext(j, sw)) / 2 + PAD) continue;
        const dp = positions[j * 4 + pu] + off(j, pu) - positions[i * 4 + pu] - off(i, pu);
        const overlap = (ext(i, pu) + ext(j, pu)) / 2 + PAD - Math.abs(dp);
        if (overlap <= 0) continue;
        const dir = dp > 0 ? 1 : dp < 0 ? -1 : i < j ? 1 : -1;
        const push = overlap * k * 0.5;
        positions[j * 4 + pu] += dir * push;
        positions[i * 4 + pu] -= dir * push;
        moved = true;
      }
    }
    return moved;
  }

  private updateStoryline(positions: Float32Array) {
    if (!this.storylineLine) return;
    const attr = this.storylineLine.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    this.storylineOrder.forEach((idx, j) => {
      arr[j * 3] = positions[idx * 4];
      arr[j * 3 + 1] = positions[idx * 4 + 1];
      arr[j * 3 + 2] = positions[idx * 4 + 2];
    });
    attr.needsUpdate = true;
  }

  /** fit the grid to the notes' actual layout: heights via a least-squares
   *  line target-y → actual-y over the dated notes (the soft pull never
   *  reaches its targets), frame size from the notes' x/z spread */
  private updateTimelineGrid(positions: Float32Array) {
    if (!this.timelineGridLines || ++this.timelineGridTick % 5 !== 1) return;
    let n = 0, st = 0, sy = 0, stt = 0, sty = 0;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const horiz = this.settings.timelineAxis === "horizontal"; // fork: the grid's own frame
    for (let i = 0; i < this.timelineTargets.length; i++) {
      const t = this.timelineTargets[i];
      const x = horiz ? positions[i * 4 + 1] : positions[i * 4];
      const y = horiz ? -positions[i * 4] : positions[i * 4 + 1];
      const z = positions[i * 4 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      if (isNaN(t)) continue;
      n++; st += t; sy += y; stt += t * t; sty += t * y;
    }
    const varT = stt - (st * st) / Math.max(n, 1);
    if (n < 2 || varT <= 0) return;
    const a = (sty - (st * sy) / n) / varT, b = (sy - a * st) / n;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const minHalf = this.settings.timelineShape === "line" ? 25 : 15; // fork: a line has no spread
    const half = Math.max(minHalf, Math.max(maxX - minX, maxZ - minZ) / 2 * 1.15);
    const lines = this.timelineGridLines;
    lines.scale.set(half, a, half);
    lines.position.set(cx, b, cz);
    lines.visible = true;
    this.timelineGridFit = { a, b, cx, cz, half };
    this.positionGridFill();
    const labelH = Math.max(this.settings.timelineShape === "line" ? 6 : 2.5, half / 18); // fork: a line's frames are small
    for (const s of this.timelineGridStops) {
      s.sprite.position.set(cx - half - 1, a * s.y + b, cz - half);
      (s.sprite as any).textHeight = labelH;
      s.sprite.visible = true;
    }
  }

  /** fork: stretch the timeline live (the switch panel's Height slider) —
   *  new date targets, storyline and grid for the current nodes, and the
   *  layout follows; no data reload. One rebuild per frame while dragging. */
  private previewTimelineLength(length: number) {
    this.settings.timelineLength = length;
    if (!this.isGraphInitialized || !this.settings.timelineLayout || !this.currentNodes.length) return;
    if (this.timelinePreviewFrame) return;
    this.timelinePreviewFrame = window.requestAnimationFrame(() => {
      this.timelinePreviewFrame = 0;
      this.initTimeline(this.currentNodes);
      this.wakePhysics();
    });
  }

  /** fork: Line shape — every dated note on one straight line in date order.
   *  Where dates crowd, the line stretches just enough that a note clears its
   *  neighbour's label (vertical: the label above the lower note; horizontal:
   *  half of both label widths); elsewhere the spacing stays true to the
   *  dates. The grid follows through `timeToAxis`, piecewise through the
   *  notes. `scale` = axis units per ms of the plain date line. */
  private spaceLine(dates: (number | null)[], scale: number) {
    const T = this.timelineTargets;
    const idx: number[] = [];
    for (let i = 0; i < T.length; i++) if (!isNaN(T[i])) idx.push(i);
    if (idx.length < 2) return;
    idx.sort((a, b) => T[a] - T[b] || a - b);
    const box = this.settings.showNodeLabels && this.labelRenderer ? this.labelRenderer.labelBoxes() : null;
    const horiz = this.settings.timelineAxis === "horizontal";
    const PAD = 2;
    const gap = (a: number, b: number) => {
      if (!box || (Math.max(a, b) + 1) * 3 > box.length) return 4;
      return horiz ? (box[a * 3] + box[b * 3]) / 2 + PAD : box[a * 3 + 2] + box[a * 3 + 1] / 2 + PAD;
    };
    const plain = idx.map((i) => T[i]);
    for (let k = 1; k < idx.length; k++) {
      const a = idx[k - 1], b = idx[k];
      T[b] = Math.max(T[b], T[a] + gap(a, b));
    }
    // keep the line centred where the plain date line was
    let shift = 0;
    idx.forEach((i, k) => (shift += T[i] - plain[k]));
    shift /= idx.length;
    for (const i of idx) T[i] -= shift;
    // date → axis through the notes (by date), straight beyond both ends
    const pts = idx.map((i) => [dates[i] as number, T[i]]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const first = pts[0], last = pts[pts.length - 1];
    this.timeToAxis = (t) => {
      if (t <= first[0]) return first[1] + (t - first[0]) * scale;
      if (t >= last[0]) return last[1] + (t - last[0]) * scale;
      let k = 1;
      while (k < pts.length - 1 && pts[k][0] < t) k++;
      const [t0, y0] = pts[k - 1], [t1, y1] = pts[k];
      return t1 === t0 ? y0 : y0 + ((t - t0) / (t1 - t0)) * (y1 - y0);
    };
  }

  /** fork: direction / shape changed — new targets and grid for the current
   *  nodes (no data reload), the layout follows; refit the camera */
  public async setTimelineForm(change: { axis?: "vertical" | "horizontal"; shape?: "spread" | "line" }) {
    const st = this.settings;
    if (change.axis) st.timelineAxis = change.axis;
    if (change.shape) st.timelineShape = change.shape;
    await this.plugin.saveSettings();
    if (this.isSettingsPanelOpen()) this.renderSettingsPanel();
    if (!this.isGraphInitialized || !this.currentNodes.length) return;
    this.initTimeline(this.currentNodes);
    this.wakePhysics();
    // refit once the notes have moved into the new form (a line eases in over
    // ~30 ticks); a timer would frame the old layout
    if (st.timelineLayout) this.fitAfterTicks = 40;
  }

  private clearStoryline() {
    this.timelineGridLines = null;
    this.timelineGridStops = [];
    this.timelineGridFill = null;
    this.timelineGridFit = null;
    if (this.hoveredGridStop !== null || this.periodNodeIds.size) {
      this.hoveredGridStop = null;
      this.periodNodeIds.clear();
    }
    if (this.timelineGridGroup) {
      this.timelineGridGroup.parent?.remove(this.timelineGridGroup);
      this.timelineGridGroup.traverse((o: any) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); });
      this.timelineGridGroup = null;
    }
    if (!this.storylineLine) return;
    this.storylineLine.parent?.remove(this.storylineLine);
    this.storylineLine.geometry.dispose();
    (this.storylineLine.material as THREE.Material).dispose();
    this.storylineLine = null;
  }

  // ---- fork: hoverable time-grid frames ------------------------------------

  /** the frame under the current raycaster ray, or null. 3D: the ray meets
   *  the frame's (horizontal) plane inside the square — nearest one wins. 2D:
   *  the frames are seen edge-on, so the band from a frame to the next one
   *  (its period) in the z = 0 plane counts. */
  private pickGridStop(): number | null {
    const fit = this.timelineGridFit;
    if (!fit || !this.settings.timelineLayout || !this.settings.timelineGridHover || !this.timelineGridLines?.visible) return null;
    const { a, b, cx, cz, half } = fit;
    // fork: the ray in the grid's own frame (turned 90° on a horizontal timeline)
    const O = this.raycaster.ray.origin, D = this.raycaster.ray.direction;
    const horiz = this.settings.timelineAxis === "horizontal";
    const o = horiz ? { x: O.y, y: -O.x, z: O.z } : O;
    const d = horiz ? { x: D.y, y: -D.x, z: D.z } : D;
    if (this.settings.flat2D) {
      if (Math.abs(d.z) < 1e-6) return null;
      const t = -o.z / d.z;
      if (t <= 0) return null;
      const x = o.x + d.x * t, y = o.y + d.y * t;
      if (Math.abs(x - cx) > half) return null;
      for (let k = 0; k < this.timelineGridStops.length; k++) {
        const s = this.timelineGridStops[k];
        const y0 = a * s.y + b, y1 = a * s.yEnd + b;
        if (y >= Math.min(y0, y1) && y <= Math.max(y0, y1)) return k;
      }
      return null;
    }
    if (Math.abs(d.y) < 1e-6) return null;
    let best: number | null = null, bestT = Infinity;
    for (let k = 0; k < this.timelineGridStops.length; k++) {
      const t = (a * this.timelineGridStops[k].y + b - o.y) / d.y;
      if (t <= 0 || t >= bestT) continue;
      const x = o.x + d.x * t, z = o.z + d.z * t;
      if (Math.abs(x - cx) <= half && Math.abs(z - cz) <= half) { best = k; bestT = t; }
    }
    return best;
  }

  /** the hovered frame's fill: the square in 3D, the period band in 2D */
  private positionGridFill() {
    const fill = this.timelineGridFill, fit = this.timelineGridFit, k = this.hoveredGridStop;
    if (!fill) return;
    if (!fit || k === null || !this.timelineGridStops[k]) { fill.visible = false; return; }
    const s = this.timelineGridStops[k];
    const y0 = fit.a * s.y + fit.b;
    if (this.settings.flat2D) {
      const y1 = fit.a * s.yEnd + fit.b;
      fill.rotation.set(0, 0, 0);
      fill.position.set(fit.cx, (y0 + y1) / 2, -0.5);
      fill.scale.set(2 * fit.half, Math.max(0.5, Math.abs(y1 - y0)), 1);
    } else {
      fill.rotation.set(-Math.PI / 2, 0, 0);
      fill.position.set(fit.cx, y0, fit.cz);
      fill.scale.set(2 * fit.half, 2 * fit.half, 1);
    }
    fill.visible = true;
  }

  /** hover a frame (null = none): fill it, and give the notes of its period
   *  (events included) a partial highlight on node and label */
  private setHoveredGridStop(k: number | null, redraw = true) {
    if (k === this.hoveredGridStop) return;
    this.hoveredGridStop = k;
    this.periodNodeIds.clear();
    const s = k !== null ? this.timelineGridStops[k] : null;
    if (s) {
      this.currentNodes.forEach((n, i) => {
        const t = this.nodeDates[i];
        if (t !== null && t !== undefined && t >= s.t0 && t < s.t1) this.periodNodeIds.add(n.id);
      });
    }
    this.positionGridFill();
    if (!redraw) return;
    this.refreshLabelHighlights();
    this.updateColors();
  }

  /** label highlight flags: 1 for the hovered node, ½ for the hovered period */
  private refreshLabelHighlights() {
    const partial = new Set<number>();
    this.periodNodeIds.forEach((id) => {
      const i = this.nodeIdToIndex.get(id);
      if (i !== undefined) partial.add(i);
    });
    const hovered = this.hoveredNode ? (this.nodeIdToIndex.get(this.hoveredNode.id) ?? null) : null;
    this.labelRenderer?.setHighlightedNode(hovered, partial);
  }

  // ---- fork: "Open in 3D graph" scope + focused source note -------------

  /** the note opened from (shown in the highlight colour, larger) */
  public focusNodeId: string | null = null;

  /** show a scope (filters) and optionally focus one note: highlight it and
   *  fly the camera to it once the layout has settled */
  public async showScope(scope: { filters: Filter[]; neighbors: boolean; focusId: string | null }) {
    this.settings.filters = scope.filters;
    this.settings.showNeighboringNodes = scope.neighbors;
    this.focusNodeId = scope.focusId;
    await this.plugin.saveSettings();
    // a freshly opened view initialises asynchronously — wait for it (max ~5 s)
    for (let i = 0; i < 50 && !this.isGraphInitialized; i++) await new Promise((r) => window.setTimeout(r, 100));
    while (this.isUpdating) await new Promise((r) => window.setTimeout(r, 100));
    if (this.isSettingsPanelOpen()) this.renderSettingsPanel();
    await this.updateData({ useCache: false, reheat: true });
    window.setTimeout(() => {
      if (scope.focusId) this.flyToNode(scope.focusId);
      else this.fitView(800);
    }, 2200);
  }

  /** camera to a node, at a distance that keeps its neighbourhood in view */
  public flyToNode(id: string, distance = 140) {
    if (!this.graph) return;
    const idx = this.nodeIdToIndex.get(id);
    if (idx === undefined || this.currentPositions.length <= idx * 4) return;
    const p = new THREE.Vector3(this.currentPositions[idx * 4], this.currentPositions[idx * 4 + 1], this.currentPositions[idx * 4 + 2]);
    const cam = this.graph.camera().position.clone();
    const dir = cam.sub(p).normalize();
    if (!isFinite(dir.x)) dir.set(0, 0, 1);
    const to = p.clone().add(dir.multiplyScalar(distance));
    this.graph.cameraPosition({ x: to.x, y: to.y, z: to.z }, { x: p.x, y: p.y, z: p.z }, 1000);
  }

  /** fork: node under the current raycaster ray — its sphere, else its label */
  private pickNodeIndex(): number | null {
    if (!this.instancedRenderer) return null;
    const hit = this.instancedRenderer.getNodeIndexAtRay(this.raycaster, this.currentPositions);
    if (hit !== null) return hit;
    if (!this.settings.showNodeLabels || !this.labelRenderer || !this.graph) return null;
    return this.labelRenderer.getNodeIndexAtLabel(this.raycaster, this.graph.camera());
  }

  /** fork: a person note — `typ: person` (or the legacy `type: person`) */
  private isPersonNote(path: string): boolean {
    return this.frontmatterMatches(path, "typ", ["person"]) || this.frontmatterMatches(path, "type", ["person"]);
  }

  /** fork: does a note's frontmatter `key` (case-insensitive key) hold one of
   *  `values`? Lists count per item; no values = the key just has to be set */
  private frontmatterMatches(path: string, key: string, values: string[]): boolean {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return false;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return false;
    const k = Object.keys(fm).find((x) => x.toLowerCase() === key);
    if (k === undefined) return false;
    const raw = fm[k];
    const items = (Array.isArray(raw) ? raw : [raw]).map((v) => String(v ?? "").trim().toLowerCase());
    if (!values.length) return items.some((v) => v !== "");
    return items.some((v) => values.includes(v));
  }


  /** fork: " · ⌥⌘G" — the command's current hotkey as Obsidian prints it
   *  (follows the user's own bindings), or "" when it has none */
  private hotkeyHint(commandId: string): string {
    try {
      const hk = (this.app as any).hotkeyManager?.printHotkeyForCommand?.(`${this.plugin.manifest.id}:${commandId}`);
      return hk ? ` · ${hk}` : "";
    } catch {
      return "";
    }
  }

  /** fork: the library's bottom help line, with the fork's gestures */
  private refreshNavInfo() {
    const el = this.graphContainer?.querySelector(".scene-nav-info") as HTMLElement | null;
    if (!el) return;
    el.setText(
      this.settings.flat2D
        ? "2D · Drag / Space+drag / two-finger: pan · Pinch / wheel: zoom · Click node: focus"
        : "Drag: rotate · Space+drag / two-finger / right-drag: pan · Pinch / wheel: zoom · WASD QE: move · Click node: focus",
    );
  }
  private refreshReverseButton() {
    this.switchPanel?.refresh(); // fork: the switch panel shows it
  }

  /** fork: flip the timeline — newest at the top ↔ oldest at the top */
  public async toggleNewestTop() {
    this.settings.timelineNewestTop = !this.settings.timelineNewestTop;
    await this.plugin.saveSettings();
    this.refreshReverseButton();
    if (this.isSettingsPanelOpen()) this.renderSettingsPanel();
    if (this.settings.timelineLayout) await this.updateData({ useCache: true, reheat: true });
  }

  private refreshFlatButton() {
    this.switchPanel?.refresh(); // fork: the switch panel shows it
    this.refreshNavInfo();
  }

  /** fork: flatten into a plane facing the camera (rotation locked), or back to 3D */
  public async toggleFlat2D() {
    this.settings.flat2D = !this.settings.flat2D;
    await this.plugin.saveSettings();
    this.refreshFlatButton();
    this.updateControls();
    if (this.isSettingsPanelOpen()) this.renderSettingsPanel();
    if (this.settings.flat2D && this.graph) {
      // face the plane straight on, keeping the current distance
      const cam = this.graph.camera().position;
      const dist = Math.max(100, Math.hypot(cam.x, cam.y, cam.z));
      this.graph.cameraPosition({ x: 0, y: 0, z: dist }, { x: 0, y: 0, z: 0 }, 800);
      this.graph.camera().up.set(0, 1, 0);
    }
    this.physicsBridge.start();
    window.setTimeout(() => this.fitView(800), 1500);
  }

  private presentationMode(): "network" | "timeline" | "storyline" {
    if (!this.settings.timelineLayout) return "network";
    return this.settings.storyline ? "storyline" : "timeline";
  }

  private refreshPresentationButton() {
    this.switchPanel?.refresh(); // fork: the switch panel shows it
  }

  /** network → timeline → timeline + storyline → network */
  public async cyclePresentation() {
    const next = { network: "timeline", timeline: "storyline", storyline: "network" }[this.presentationMode()] as "network" | "timeline" | "storyline";
    await this.setPresentation(next);
  }

  /** fork: one presentation directly (the segmented switch) */
  public async setPresentation(next: "network" | "timeline" | "storyline") {
    this.settings.timelineLayout = next !== "network";
    this.settings.storyline = next === "storyline";
    await this.plugin.saveSettings();
    this.refreshPresentationButton();
    this.refreshReverseButton();
    if (this.isSettingsPanelOpen()) this.renderSettingsPanel();
    await this.updateData({ useCache: true, reheat: true });
    window.setTimeout(() => this.fitView(800), 1500);
  }

  private renderTimelineSettings(container: HTMLElement) {
    new Setting(container).setHeading().setName("Timeline");
    const redraw = async () => {
      await this.plugin.saveSettings();
      this.refreshPresentationButton();
      this.refreshReverseButton();
      this.updateData({ useCache: true, reheat: true });
    };
    new Setting(container)
      .setName("Timeline layout")
      .setDesc("Order notes vertically by date (file-name timestamp, then datum, then creation date).")
      .addToggle((t) => t.setValue(this.settings.timelineLayout).onChange(async (v) => { this.settings.timelineLayout = v; await redraw(); }));
    new Setting(container).setName("Newest at the top").addToggle((t) =>
      t.setValue(this.settings.timelineNewestTop).onChange(async (v) => { this.settings.timelineNewestTop = v; await redraw(); }));
    new Setting(container).setName("Timeline strength").addSlider((s) =>
      s.setLimits(0.01, 0.5, 0.01).setValue(this.settings.timelineStrength).setDynamicTooltip()
        .onChange(async (v) => { this.settings.timelineStrength = v; await this.plugin.saveSettings(); }));
    new Setting(container).setName("Direction").addDropdown((d) =>
      d.addOptions({ vertical: "Vertical (up/down)", horizontal: "Horizontal (left → right)" })
        .setValue(this.settings.timelineAxis)
        .onChange((v) => this.setTimelineForm({ axis: v as "vertical" | "horizontal" })));
    new Setting(container).setName("Shape").setDesc("Spread: the network keeps its shape across the axis. Line: every dated note on one straight line.").addDropdown((d) =>
      d.addOptions({ spread: "Spread", line: "Straight line" })
        .setValue(this.settings.timelineShape)
        .onChange((v) => this.setTimelineForm({ shape: v as "spread" | "line" })));
    new Setting(container).setName("Timeline length").addSlider((s) =>
      s.setLimits(100, 3000, 50).setValue(this.settings.timelineLength).setDynamicTooltip()
        .onChange(async (v) => { this.settings.timelineLength = v; await redraw(); }));
    new Setting(container)
      .setName("2D mode")
      .setDesc("Flatten the graph into a plane facing you; pan and zoom, no rotation. With the timeline it becomes a flat time chart.")
      .addToggle((t) => t.setValue(this.settings.flat2D).onChange(async (v) => { if (v !== this.settings.flat2D) await this.toggleFlat2D(); }));
    new Setting(container)
      .setName("Two-finger drag pans")
      .setDesc("Trackpad: two-finger drag moves the view, pinch zooms. Mouse wheels keep zooming. Space + drag always pans.")
      .addToggle((t) => t.setValue(this.settings.trackpadPan).onChange(async (v) => { this.settings.trackpadPan = v; await this.plugin.saveSettings(); }));
    new Setting(container)
      .setName("Time grid")
      .setDesc("Week or month frames behind the timeline, labelled.")
      .addDropdown((d) =>
        d
          .addOptions({ off: "Off", week: "Weeks", month: "Months", auto: "Auto" })
          .setValue(this.settings.timelineGrid)
          .onChange(async (v) => { this.settings.timelineGrid = v as "off" | "week" | "month" | "auto"; await redraw(); }),
      );
    new Setting(container)
      .setName("Hover time-grid frames")
      .setDesc("Hovering a week/month frame fills it faintly and lights up the notes of that period.")
      .addToggle((t) => t.setValue(this.settings.timelineGridHover).onChange(async (v) => {
        this.settings.timelineGridHover = v;
        if (!v) this.setHoveredGridStop(null);
        await this.plugin.saveSettings();
      }));
    new Setting(container)
      .setName("Storyline")
      .setDesc("A line through the notes in date order.")
      .addToggle((t) => t.setValue(this.settings.storyline).onChange(async (v) => { this.settings.storyline = v; await redraw(); }));
  }

  private renderLabelSettings(container: HTMLElement) {
    new Setting(container).setHeading().setName("Labels");

    new Setting(container).setName("Show labels on hover/highlight only").addToggle((toggle) =>
      toggle.setValue(this.settings.showLabelsOnHoverOnly).onChange(async (value) => {
        this.settings.showLabelsOnHoverOnly = value;
        await this.plugin.saveSettings();
        this.updateDisplay();
      }),
    );

    new Setting(container).setName("Keep labels apart").addSlider((s) =>
      s
        .setLimits(0, 1, 0.05)
        .setValue(this.settings.labelSeparation)
        .setDynamicTooltip()
        .onChange(async (v) => {
          this.settings.labelSeparation = v;
          await this.plugin.saveSettings(); // wakes the layout
        }),
    );

    new Setting(container).setName("Label distance").addSlider((s) =>
      s
        .setLimits(50, 1500, 10) // fork: was 50–500
        .setValue(this.settings.labelDistance)
        .setDynamicTooltip()
        .onChange(async (v) => {
          this.settings.labelDistance = v;
          await this.plugin.saveSettings();
        }),
    );
  }

  private renderInteractionSettings(container: HTMLElement) {
    new Setting(container).setHeading().setName("Interaction");

    new Setting(container).setName("Use Keyboard Controls (WASD)").addToggle((toggle) =>
      toggle.setValue(this.settings.useKeyboardControls).onChange(async (value) => {
        this.settings.useKeyboardControls = value;
        await this.plugin.saveSettings();
        this.updateControls();
      }),
    );

    new Setting(container).setName("Keyboard move speed").addSlider((s) =>
      s
        .setLimits(0.1, 10, 0.1)
        .setValue(this.settings.keyboardMoveSpeed)
        .setDynamicTooltip()
        .onChange(async (v) => {
          this.settings.keyboardMoveSpeed = v;
          await this.plugin.saveSettings();
        }),
    );

    new Setting(container).setName("Zoom on click").addToggle((toggle) =>
      toggle.setValue(this.settings.zoomOnClick).onChange(async (value) => {
        this.settings.zoomOnClick = value;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(container).setName("Rotation speed").addSlider((s) =>
      s
        .setLimits(0.1, 5, 0.1)
        .setValue(this.settings.rotateSpeed)
        .setDynamicTooltip()
        .onChange(async (v) => {
          this.settings.rotateSpeed = v;
          await this.plugin.saveSettings();
          this.updateControls();
        }),
    );

    new Setting(container).setName("Pan speed").addSlider((s) =>
      s
        .setLimits(0.1, 5, 0.1)
        .setValue(this.settings.panSpeed)
        .setDynamicTooltip()
        .onChange(async (v) => {
          this.settings.panSpeed = v;
          await this.plugin.saveSettings();
          this.updateControls();
        }),
    );

    new Setting(container).setName("Zoom speed").addSlider((s) =>
      s
        .setLimits(0.1, 5, 0.1)
        .setValue(this.settings.zoomSpeed)
        .setDynamicTooltip()
        .onChange(async (v) => {
          this.settings.zoomSpeed = v;
          await this.plugin.saveSettings();
          this.updateControls();
        }),
    );
  }

  private renderForceSettings(container: HTMLElement) {
    new Setting(container).setHeading().setName("Forces");

    const forceChangeHandler = async () => {
      await this.plugin.saveSettings();
      this.updateData({ useCache: false, reheat: true });
    };

    new Setting(container).setName("Center force").addSlider((slider) =>
      slider
        .setLimits(0, 1, 0.01)
        .setValue(this.settings.centerForce)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.settings.centerForce = value;
          await forceChangeHandler();
        }),
    );

    new Setting(container).setName("Repel force").addSlider((slider) =>
      slider
        .setLimits(0, 40, 0.1) // fork: was 0–20
        .setValue(this.settings.repelForce)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.settings.repelForce = value;
          await forceChangeHandler();
        }),
    );

    new Setting(container).setName("Link distance").addSlider((slider) =>
      slider
        .setLimits(10, 150, 5)
        .setValue(this.settings.linkDistance)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.settings.linkDistance = value;
          await forceChangeHandler();
        }),
    );
  }

  private initializeForces() {
    this.chargeForce = this.graph.d3Force("charge");
    this.centerForce = this.graph.d3Force("center");
    this.linkForce = this.graph.d3Force("link");
  }

  private handleKeyDown(event: KeyboardEvent) {
    const movementKeys = ["w", "a", "s", "d", "q", "e"];
    const key = event.key.toLowerCase();
    // fork fix: never swallow shortcuts — with ⌘/Ctrl/⌥ held these are app
    // commands (⌘Q quit, ⌘W close, ⌘S, ⌘E …), not camera moves. macOS also
    // sends no keyup for a key pressed with ⌘, so it would stay "held".
    if (event.metaKey || event.ctrlKey || event.altKey) {
      this.pressedKeys.clear();
      return;
    }

    if (this.settings.useKeyboardControls && movementKeys.includes(key)) {
      event.preventDefault();
      this.pressedKeys.add(key);
    }
  }

  private handleKeyUp(event: KeyboardEvent) {
    if (this.settings.useKeyboardControls) {
      this.pressedKeys.delete(event.key.toLowerCase());
    }
  }

  private handleKeyboardMovement() {
    if (!this.settings.useKeyboardControls || this.pressedKeys.size === 0) return;

    const controls = this.graph.controls();
    const camera = this.graph.camera();
    if (!controls || !camera) return;

    const moveSpeed = this.settings.keyboardMoveSpeed;
    camera.getWorldDirection(this.keyboardDirection);

    this.keyboardRight.crossVectors(this.keyboardDirection, camera.up).normalize();

    this.keyboardMoveVector.set(0, 0, 0);

    if (this.pressedKeys.has("w")) this.keyboardMoveVector.add(this.keyboardDirection);
    if (this.pressedKeys.has("s")) this.keyboardMoveVector.sub(this.keyboardDirection);
    if (this.pressedKeys.has("a")) this.keyboardMoveVector.sub(this.keyboardRight);
    if (this.pressedKeys.has("d")) this.keyboardMoveVector.add(this.keyboardRight);

    if (this.keyboardMoveVector.lengthSq() > 0) {
      this.keyboardMoveVector.normalize().multiplyScalar(moveSpeed);
      this.keyboardNewPos.copy(camera.position).add(this.keyboardMoveVector);
      this.keyboardNewTarget.copy(controls.target).add(this.keyboardMoveVector);
      this.graph.cameraPosition(this.keyboardNewPos, this.keyboardNewTarget);
    }

    if (this.pressedKeys.has("e")) {
      this.keyboardNewPos.copy(camera.position);
      this.keyboardNewPos.y += moveSpeed;
      this.keyboardNewTarget.copy(controls.target);
      this.keyboardNewTarget.y += moveSpeed;
      this.graph.cameraPosition(this.keyboardNewPos, this.keyboardNewTarget);
    }
    if (this.pressedKeys.has("q")) {
      this.keyboardNewPos.copy(camera.position);
      this.keyboardNewPos.y -= moveSpeed;
      this.keyboardNewTarget.copy(controls.target);
      this.keyboardNewTarget.y -= moveSpeed;
      this.graph.cameraPosition(this.keyboardNewPos, this.keyboardNewTarget);
    }
  }

  private syncDragPositionsToWasm(node?: GraphNode) {
    if (!this.settings.useWasmPhysics || this.currentPositions.length === 0) return;
    if (this.dragSyncBuffer.length !== this.currentPositions.length) {
      this.dragSyncBuffer = new Float32Array(this.currentPositions.length);
    }
    this.dragSyncBuffer.set(this.currentPositions);
    if (node) {
      const idx = this.nodeIdToIndex.get(node.id);
      if (idx !== undefined) {
        this.dragSyncBuffer[idx * 4] = node.x || 0;
        this.dragSyncBuffer[idx * 4 + 1] = node.y || 0;
        this.dragSyncBuffer[idx * 4 + 2] = node.z || 0;
      }
    }
    this.physicsBridge.setPositions(this.dragSyncBuffer);
    this.wakePhysics(); // fork: a settled layout reacts to the drag
  }

  // ---- fork: pan the whole view — Space + drag, trackpad two-finger drag,
  // and plain left-drag in 2D mode (where there is no rotation) -------------

  /** move camera and orbit target together in the screen plane */
  private panView(dxPx: number, dyPx: number) {
    if (!this.graph) return;
    const cam = this.graph.camera(), controls = this.graph.controls() as any;
    if (!cam || !controls?.target) return;
    const h = this.graphContainer.clientHeight || 1;
    const dist = cam.position.distanceTo(controls.target);
    const fov = ((cam as THREE.PerspectiveCamera).fov || 50) * Math.PI / 180;
    const perPx = (2 * dist * Math.tan(fov / 2)) / h; // world units per screen pixel at the target
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
    const offset = right.multiplyScalar(-dxPx * perPx).add(up.multiplyScalar(dyPx * perPx));
    cam.position.add(offset);
    controls.target.add(offset);
    this.setHoveredGridStop(null); // fork: no frame hover while panning
    this.updateLabels();
  }

  private setupPanControls() {
    if (!this.graphContainer) return;
    let spaceHeld = false, pointerOver = false, panning = false, last = { x: 0, y: 0 };
    const isTyping = () => {
      const a = document.activeElement as HTMLElement | null;
      return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
    };
    const setCursor = () => this.graphContainer.setCssStyles({ cursor: panning ? "grabbing" : spaceHeld && pointerOver ? "grab" : "" });

    this.registerDomEvent(this.graphContainer, "pointerenter", () => { pointerOver = true; setCursor(); });
    this.registerDomEvent(this.graphContainer, "pointerleave", () => { pointerOver = false; setCursor(); });
    this.registerDomEvent(window, "keydown", (e: KeyboardEvent) => {
      if (e.code !== "Space" || !pointerOver || isTyping()) return;
      e.preventDefault(); // no page scroll / button activation
      if (!spaceHeld) { spaceHeld = true; setCursor(); }
    });
    this.registerDomEvent(window, "keyup", (e: KeyboardEvent) => {
      if (e.code === "Space") { spaceHeld = false; setCursor(); }
    });
    this.registerDomEvent(window, "blur", () => { spaceHeld = false; panning = false; setCursor(); });

    // capture phase: decide before the trackball / node-drag handlers see it
    const onNode = (e: PointerEvent) => {
      if (!this.instancedRenderer || this.currentPositions.length === 0) return false;
      const rect = this.graphContainer.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1));
      this.raycaster.setFromCamera(ndc, this.graph.camera());
      return this.pickNodeIndex() !== null;
    };
    this.registerDomEvent(this.graphContainer, "pointerdown", (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!spaceHeld && !(this.settings.flat2D && !onNode(e))) return;
      e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
      panning = true; last = { x: e.clientX, y: e.clientY };
      this.graphContainer.setPointerCapture?.(e.pointerId);
      setCursor();
    }, { capture: true });
    this.registerDomEvent(this.graphContainer, "pointermove", (e: PointerEvent) => {
      if (!panning) return;
      e.stopImmediatePropagation(); e.stopPropagation();
      this.panView(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
    }, { capture: true });
    const end = (e: PointerEvent) => {
      if (!panning) return;
      e.stopImmediatePropagation(); e.stopPropagation();
      panning = false;
      this.graphContainer.releasePointerCapture?.(e.pointerId);
      setCursor();
    };
    this.registerDomEvent(this.graphContainer, "pointerup", end, { capture: true });
    this.registerDomEvent(this.graphContainer, "pointercancel", end, { capture: true });

    // trackpad two-finger drag → pan; pinch (ctrlKey) and mouse wheels → zoom as before.
    // A trackpad sends small, fractional or sideways deltas; a wheel big round steps.
    this.registerDomEvent(this.graphContainer, "wheel", (e: WheelEvent) => {
      if (!this.settings.trackpadPan || e.ctrlKey) return;
      const trackpad = e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 40);
      if (!trackpad) return;
      e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
      this.panView(-e.deltaX, -e.deltaY);
    }, { capture: true, passive: false });
  }

  private setupPointerInteractions() {
    if (!this.graphContainer) return;

    let isPointerDown = false;
    let pointerDownPos = { x: 0, y: 0 };
    let draggedNode: GraphNode | null = null;
    const dragPlane = new THREE.Plane();
    const planeIntersect = new THREE.Vector3();
    const tempCamDir = new THREE.Vector3();
    const pointerNdc = new THREE.Vector2();

    const updatePointerNDC = (e: MouseEvent | PointerEvent) => {
      const rect = this.graphContainer.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      return pointerNdc;
    };

    this.registerDomEvent(this.graphContainer, "pointerdown", (e: PointerEvent) => {
      if (e.button !== 0) return;
      isPointerDown = true;
      pointerDownPos = { x: e.clientX, y: e.clientY };

      if (!this.graph || !this.instancedRenderer || this.currentPositions.length === 0) return;
      const camera = this.graph.camera();
      if (!camera) return;

      const ndc = updatePointerNDC(e);
      this.raycaster.setFromCamera(ndc, camera);
      const hitIdx = this.pickNodeIndex();

      if (hitIdx !== null && hitIdx < this.currentNodes.length) {
        draggedNode = this.currentNodes[hitIdx];
        const controls = this.graph.controls();
        if (controls) controls.enabled = false;

        const nodePos = new THREE.Vector3(
          this.currentPositions[hitIdx * 4],
          this.currentPositions[hitIdx * 4 + 1],
          this.currentPositions[hitIdx * 4 + 2],
        );
        camera.getWorldDirection(tempCamDir);
        dragPlane.setFromNormalAndCoplanarPoint(tempCamDir.negate(), nodePos);
      }
    });

    // fork: leaving the graph while over a node must end the hover too, or
    // the page-preview popover stays open (nothing else tells it to close)
    this.registerDomEvent(this.graphContainer, "pointerleave", () => {
      if (this.hoveredNode) this.handleNodeHover(null);
      else this.endHoverPreview();
      this.setHoveredGridStop(null); // fork
    });

    this.registerDomEvent(this.graphContainer, "pointermove", (e: PointerEvent) => {
      if (!this.graph || !this.instancedRenderer || this.currentPositions.length === 0) return;
      const camera = this.graph.camera();
      if (!camera) return;

      const ndc = updatePointerNDC(e);
      this.raycaster.setFromCamera(ndc, camera);

      if (draggedNode && isPointerDown) {
        if (this.raycaster.ray.intersectPlane(dragPlane, planeIntersect)) {
          draggedNode.x = planeIntersect.x;
          draggedNode.y = planeIntersect.y;
          draggedNode.z = planeIntersect.z;
          const idx = this.nodeIdToIndex.get(draggedNode.id);
          if (idx !== undefined) {
            this.currentPositions[idx * 4] = planeIntersect.x;
            this.currentPositions[idx * 4 + 1] = planeIntersect.y;
            this.currentPositions[idx * 4 + 2] = planeIntersect.z;
          }
          this.instancedRenderer.updatePositions(this.currentPositions);
          this.syncDragPositionsToWasm(draggedNode);
        }
      } else {
        const hitIdx = this.pickNodeIndex();
        const node = hitIdx !== null ? this.currentNodes[hitIdx] : null;
        if (node !== this.hoveredNode) {
          this.handleNodeHover(node, e);
        }
        // fork: time-grid frame under the pointer — not while a button is
        // held (rotating), and a node/label wins over the frame beneath it
        if (!node && !isPointerDown && e.buttons === 0) this.setHoveredGridStop(this.pickGridStop());
        else if (isPointerDown || e.buttons !== 0) this.setHoveredGridStop(null);
      }
    });

    const onPointerUp = () => {
      if (draggedNode) {
        this.syncDragPositionsToWasm(draggedNode);
        draggedNode = null;
        const controls = this.graph?.controls();
        if (controls) controls.enabled = true;
      }
      isPointerDown = false;
    };

    this.registerDomEvent(this.graphContainer, "pointerup", onPointerUp);
    this.registerDomEvent(this.graphContainer, "pointerleave", onPointerUp);

    this.registerDomEvent(this.graphContainer, "click", (e: MouseEvent) => {
      const distSq = (e.clientX - pointerDownPos.x) ** 2 + (e.clientY - pointerDownPos.y) ** 2;
      if (distSq > 25) return;

      if (!this.graph || !this.instancedRenderer || this.currentPositions.length === 0) return;
      const camera = this.graph.camera();
      if (!camera) return;

      const ndc = updatePointerNDC(e);
      this.raycaster.setFromCamera(ndc, camera);
      const hitIdx = this.pickNodeIndex();

      if (hitIdx !== null && hitIdx < this.currentNodes.length) {
        this.handleNodeClick(this.currentNodes[hitIdx], e);
      } else {
        if (this.selectedNode !== null || this.highlightedNodes.size > 0) {
          this.selectedNode = null;
          this.highlightedNodes.clear();
          this.highlightedLinks.clear();
          this.updateColors();
        }
      }
    });

    this.registerDomEvent(this.graphContainer, "dblclick", (e: MouseEvent) => {
      if (!this.graph || !this.instancedRenderer || this.currentPositions.length === 0) return;
      const camera = this.graph.camera();
      if (!camera) return;

      const ndc = updatePointerNDC(e);
      this.raycaster.setFromCamera(ndc, camera);
      const hitIdx = this.pickNodeIndex();

      if (hitIdx !== null && hitIdx < this.currentNodes.length) {
        this.handleNodeDoubleClick(this.currentNodes[hitIdx]);
      }
    });
  }

  initializeGraph() {
    this.app.workspace.onLayoutReady(async () => {
      if (!this.graphContainer) return;

      const Graph = (ForceGraph3D as any).default || ForceGraph3D;
      this.graph = Graph()(this.graphContainer)
        .nodeVisibility(false)
        .linkVisibility(false)
        .linkCurvature((link: ProcessedGraphLink) => this.getLinkCurvature(link))
        .onEngineTick(() => {
          this.handleKeyboardMovement();
        });

      const scene = this.graph.scene();
      this.instancedRenderer = new InstancedGraphRenderer(scene);
      this.labelRenderer = new InstancedLabelRenderer(scene);

      this.setupPointerInteractions();
      this.setupPanControls();
      this.refreshNavInfo();

      this.graph.graphData({ nodes: [], links: [] });

      this.initializeForces();
      this.graph.pauseAnimation();
      this.isGraphInitialized = true;

      setTimeout(() => {
        this.updateData({ isFirstLoad: true });
      }, 100);
    });
  }

  public async updateData(
    options: { useCache?: boolean; reheat?: boolean; isFirstLoad?: boolean } = {},
  ) {
    const { useCache = true, reheat = false, isFirstLoad = false } = options;

    if (!this.isGraphInitialized || this.isUpdating) {
      return;
    }
    this.isUpdating = true;

    this.updatePreprocessedGroups();

    try {
      const nodePositions = new Map<string, { x: number; y: number; z: number }>();
      if (useCache && this.graph.graphData().nodes.length > 0) {
        this.graph.graphData().nodes.forEach((node: GraphNode) => {
          if (node.id && node.x !== undefined && node.y !== undefined && node.z !== undefined) {
            nodePositions.set(node.id, {
              x: node.x,
              y: node.y,
              z: node.z,
            });
          }
        });
      }

      const newData = await this.processVaultData();
      const hasNodes = newData && newData.nodes.length > 0;

      const oldNodes = this.graph.graphData().nodes as GraphNode[];
      if (oldNodes.length > 0) {
        const newNodeIds = new Set(hasNodes ? newData.nodes.map((n) => n.id) : []);
        const nodesToRemove = oldNodes.filter((node) => !newNodeIds.has(node.id));
        nodesToRemove.forEach((node) => this.cleanupNode(node));
      }

      if (hasNodes) {
        if (useCache) {
          const adjacencyMap: Map<string, string[]> = new Map();
          newData.links.forEach((link) => {
            const sourceId = link.source as string;
            const targetId = link.target as string;

            if (!adjacencyMap.has(sourceId)) adjacencyMap.set(sourceId, []);
            if (!adjacencyMap.has(targetId)) adjacencyMap.set(targetId, []);

            adjacencyMap.get(sourceId)!.push(targetId);
            adjacencyMap.get(targetId)!.push(sourceId);
          });

          newData.nodes.forEach((node) => {
            const cachedPos = nodePositions.get(node.id);
            if (cachedPos) {
              node.x = cachedPos.x;
              node.y = cachedPos.y;
              node.z = cachedPos.z;
            } else {
              const neighbors = adjacencyMap.get(node.id) || [];
              let connectedNodePos: { x: number; y: number; z: number } | undefined;

              for (const neighborId of neighbors) {
                connectedNodePos = nodePositions.get(neighborId);
                if (connectedNodePos) break;
              }

              if (connectedNodePos) {
                node.x = connectedNodePos.x + (Math.random() - 0.5) * 2;
                node.y = connectedNodePos.y + (Math.random() - 0.5) * 2;
                node.z = connectedNodePos.z + (Math.random() - 0.5) * 2;
              }
            }
          });
        }

        this.graph.pauseAnimation();
        this.messageEl.removeClass("is-visible");

        this.reciprocalLinks.clear();
        const seenLinks = new Set<string>();
        const linksCount = newData.links.length;
        for (let i = 0; i < linksCount; i++) {
          const link = newData.links[i];
          const src = typeof link.source === "object" ? (link.source as GraphNode).id : (link.source as string);
          const tgt = typeof link.target === "object" ? (link.target as GraphNode).id : (link.target as string);
          const directKey = `${src}->${tgt}`;
          const reverseKey = `${tgt}->${src}`;
          if (seenLinks.has(reverseKey)) {
            this.reciprocalLinks.add(directKey);
            this.reciprocalLinks.add(reverseKey);
          }
          seenLinks.add(directKey);
        }

        this.nodeMap.clear();
        newData.nodes.forEach((node) => {
          this.nodeMap.set(node.id, node);
        });

        this.currentNodes = newData.nodes;
        this.currentLinks = newData.links;
        this.nodeIdToIndex.clear();
        newData.nodes.forEach((n: GraphNode, idx: number) => this.nodeIdToIndex.set(n.id, idx));
        this.linkToIndex.clear();
        newData.links.forEach((l: GraphLink, idx: number) => this.linkToIndex.set(l, idx));

        this.graph.graphData(newData);
        this.occludersCacheDirty = true;

        this.linkAdjacencyIndex.clear();
        const processedLinks = this.graph.graphData().links as ProcessedGraphLink[];
        processedLinks.forEach((link) => {
          const sourceId =
            typeof link.source === "object"
              ? (link.source as GraphNode).id
              : (link.source as string);
          const targetId =
            typeof link.target === "object"
              ? (link.target as GraphNode).id
              : (link.target as string);

          if (!this.linkAdjacencyIndex.has(sourceId)) {
            this.linkAdjacencyIndex.set(sourceId, []);
          }
          if (!this.linkAdjacencyIndex.has(targetId)) {
            this.linkAdjacencyIndex.set(targetId, []);
          }
          this.linkAdjacencyIndex.get(sourceId)!.push(link);
          this.linkAdjacencyIndex.get(targetId)!.push(link);
        });

        if (this.counterEl) {
          this.counterEl.setText(`${newData.nodes.length} nodes · ${newData.links.length} links`);
          this.counterEl.addClass("is-visible");
        }

        if (this.settings.useWasmPhysics && hasNodes) {
          this.graph.d3AlphaDecay(1);

          const edgesList: number[] = [];
          const edgeDataList: { source: number; target: number }[] = [];
          newData.links.forEach((l: GraphLink) => {
            const srcId =
              typeof l.source === "object" ? (l.source as GraphNode).id : (l.source as string);
            const tgtId =
              typeof l.target === "object" ? (l.target as GraphNode).id : (l.target as string);
            const srcIdx = this.nodeIdToIndex.get(srcId);
            const tgtIdx = this.nodeIdToIndex.get(tgtId);
            if (srcIdx !== undefined && tgtIdx !== undefined) {
              edgesList.push(srcIdx, tgtIdx);
              edgeDataList.push({ source: srcIdx, target: tgtIdx });
            }
          });

          const nodeDataList = newData.nodes.map((n: GraphNode) => ({
            id: n.id,
            name: n.name,
            shape: this.getNodeShape(n),
            val: this.getNodeSize(n),
            color: this.getNodeColor(n),
          }));

          const linkColor = this.settings.useThemeColors
            ? this.getCssColor("--graph-line", this.settings.colorLink)
            : this.settings.colorLink;

          this.instancedRenderer?.initGraph(
            nodeDataList,
            edgeDataList,
            this.settings.nodeSize,
            linkColor,
            0.6,
          );
          this.labelRenderer?.initLabels(newData.nodes, this.settings, 4);
          this.initTimeline(newData.nodes);

          this.updateForces();
          this.updateDisplay();
          this.updateControls();

          this.physicsBridge
            .init(
              getWasmArrayBuffer(),
              createWorkerBlobUrl(),
              newData.nodes.length,
              new Uint32Array(edgesList),
              this.physicsParams(),
            )
            .then(() => {
              this.settleTicks = 0;
              this.physicsBridge.onTick((positions) => this.onPhysicsTick(positions));
              this.physicsBridge.start();
            })
            .catch((err) => {
              console.error(
                "[3D Graph] WASM Physics engine failed to start, falling back to D3 force engine:",
                err,
              );
            });
        } else if (isFirstLoad || reheat) {
          this.graph.d3AlphaDecay(0.0228);
          this.graph.d3VelocityDecay(0.4);
          this.graph.d3ReheatSimulation();
        } else if (useCache) {
          this.graph.d3AlphaDecay(0.1);
          this.graph.d3VelocityDecay(0.6);
        }

        this.graph.resumeAnimation();
      } else {
        this.graph.graphData({ nodes: [], links: [] });
        this.instancedRenderer?.clear();
        this.labelRenderer?.clear();
        this.clearStoryline();
        this.currentPositions = new Float32Array(0);
        this.currentNodes = [];
        this.currentLinks = [];
        this.colorCache.clear();
        const bgColor = this.settings.useThemeColors
          ? this.getCssColor("--background-primary", "#000000")
          : this.settings.backgroundColor;
        this.graph.backgroundColor(bgColor);
        this.messageEl.setText("No search results or filters matched.");
        this.messageEl.addClass("is-visible");
        if (this.counterEl) {
          this.counterEl.setText("");
          this.counterEl.removeClass("is-visible");
        }
        this.graph.pauseAnimation();
      }
    } catch (error) {
      console.error("3D Graph: An error occurred during updateData:", error);
    } finally {
      this.isUpdating = false;
    }
  }

  public updateColors() {
    if (!this.isGraphInitialized) return;

    this.updatePreprocessedGroups();

    const bgColor = this.settings.useThemeColors
      ? this.getCssColor("--background-primary", "#000000")
      : this.settings.backgroundColor;
    this.graph.backgroundColor(bgColor);

    if (this.instancedRenderer && this.currentNodes.length > 0) {
      const colorMap = new Map<number, string>();
      this.currentNodes.forEach((node, idx) => {
        colorMap.set(idx, this.getNodeColor(node));
      });
      this.instancedRenderer.updateNodeColors(colorMap);
      // fork: labels carry their node's colour; theme/settings colours as uniforms
      this.labelRenderer?.setStyle(labelStyleFrom(this.settings, this.highlightColor()));
      this.labelRenderer?.setNodeColors(this.currentNodes.map((n) => this.getNodeColor(n, true)));

      const linkHighlightColor = this.settings.useThemeColors
        ? this.getCssColor("--graph-node-focused", this.settings.colorHighlight)
        : this.settings.colorHighlight;
      const linkColor = this.settings.useThemeColors
        ? this.getCssColor("--graph-line", this.settings.colorLink)
        : this.settings.colorLink;

      const highlightedEdgeIndices = new Set<number>();
      this.highlightedLinks.forEach((linkObj) => {
        const idx = this.linkToIndex.get(linkObj as GraphLink);
        if (idx !== undefined) highlightedEdgeIndices.add(idx);
      });
      this.instancedRenderer.updateEdgeColors(highlightedEdgeIndices, linkHighlightColor, linkColor);
    }

    if (this.labelRenderer && this.currentPositions.length > 0) {
      this.labelRenderer.updateVisibilityAndOcclusion(
        this.graph.camera(),
        this.currentPositions,
        this.settings,
        this.hoveredNode ? this.hoveredNode.id : null,
        this.highlightedNodes,
      );
    }
  }

  private getCssColor(variable: string, fallback: string): string {
    if (this.colorCache.has(variable)) {
      return this.colorCache.get(variable)!;
    }

    try {
      const varName = variable.startsWith("--")
        ? variable
        : `--${variable.replace(/^var\(/, "").replace(/\)$/, "")}`;

      if (!this.colorResolverEl) {
        this.colorResolverEl = document.createElement("div");
        this.colorResolverEl.style.display = "none";
        document.body.appendChild(this.colorResolverEl);
      }
      this.colorResolverEl.style.color = `var(${varName})`;
      const computed = getComputedStyle(this.colorResolverEl).color;

      if (!this.colorCanvasCtx) {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        this.colorCanvasCtx = canvas.getContext("2d", { willReadFrequently: true });
      }

      if (this.colorCanvasCtx && computed) {
        this.colorCanvasCtx.fillStyle = computed;
        this.colorCanvasCtx.fillRect(0, 0, 1, 1);
        const [r, g, b] = this.colorCanvasCtx.getImageData(0, 0, 1, 1).data;
        const finalColor = `rgb(${r}, ${g}, ${b})`;
        this.colorCache.set(variable, finalColor);
        return finalColor;
      }

      if (computed && (computed.startsWith("#") || computed.startsWith("rgb"))) {
        this.colorCache.set(variable, computed);
        return computed;
      }
    } catch (e) {
      console.error(`3D Graph: Could not parse CSS color variable ${variable}`, e);
    }

    this.colorCache.set(variable, fallback);
    return fallback;
  }

  public setGroupsDirty() {
    this.groupsDirty = true;
  }

  /** fork: `palette: key=path/to/note.md` — one prop group per
   *  `value: "#hex"` line of that note's frontmatter, in the note's order.
   *  Entries that aren't hex colours (numbers, settings) are skipped. */
  private paletteGroups(body: string): PreprocessedGroup[] {
    const eq = body.indexOf("=");
    if (eq < 0) return [];
    const propKey = body.slice(0, eq).trim().toLowerCase();
    const ref = body.slice(eq + 1).trim();
    if (!propKey || !ref) return [];
    const file =
      this.app.vault.getAbstractFileByPath(ref) ??
      this.app.vault.getAbstractFileByPath(`${ref}.md`) ??
      this.app.metadataCache.getFirstLinkpathDest(ref, "");
    this.paletteSources.add(file instanceof TFile ? file.path : ref);
    if (!(file instanceof TFile)) return [];
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const groups: PreprocessedGroup[] = [];
    for (const [value, color] of Object.entries(fm)) {
      if (typeof color !== "string" || !PALETTE_HEX.test(color.trim())) continue;
      groups.push({
        color: color.trim(),
        query: `prop:${propKey}=${value.toLowerCase()}`,
        type: "prop",
        propKey,
        propValues: [value.trim().toLowerCase()],
      });
    }
    return groups;
  }

  private updatePreprocessedGroups() {
    if (!this.groupsDirty) return;
    this.paletteSources.clear();
    const expanded = this.settings.groups
      .map((group): PreprocessedGroup | PreprocessedGroup[] => {
        const query = group.query.toLowerCase();
        // fork: colours from a note — "palette: typ=_views/kortfärger.md"
        if (query.startsWith("palette:")) return this.paletteGroups(group.query.substring(8).trim());
        if (!query) {
          return {
            color: group.color,
            query: "",
            type: "text" as const,
          };
        }

        if (query.startsWith("path:")) {
          return {
            color: group.color,
            query,
            type: "path" as const,
            pathQuery: query.substring(5).trim(),
          };
        } else if (query.startsWith("tag:")) {
          return {
            color: group.color,
            query,
            type: "tag" as const,
            tagQuery: query.substring(4).trim().replace(/^#/, ""),
          };
        } else if (query.startsWith("prop:")) {
          // fork: frontmatter property — "prop: typ=person", alternatives with | ("prop: typ=email|mail")
          const body = group.query.substring(5).trim();
          const eq = body.indexOf("=");
          return {
            color: group.color,
            query,
            type: "prop" as const,
            propKey: (eq >= 0 ? body.slice(0, eq) : body).trim().toLowerCase(),
            propValues: eq >= 0 ? body.slice(eq + 1).split("|").map((v) => v.trim().toLowerCase()).filter(Boolean) : [],
          };
        } else if (query.startsWith("name:")) {
          // fork: words in the file name, as a case-insensitive regex — "name: möte|meeting"
          const body = group.query.substring(5).trim();
          let nameRegex: RegExp;
          try {
            nameRegex = new RegExp(body, "iu");
          } catch {
            nameRegex = new RegExp(body.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
          }
          return { color: group.color, query, type: "name" as const, nameRegex };
        } else if (query.startsWith("file:")) {
          const fileQuery = query.substring(5).trim();
          let fileRegex: RegExp | undefined;
          if (fileQuery.includes("*")) {
            const pattern = fileQuery.replace(/\./g, "\\.").replace(/\*/g, ".*");
            fileRegex = new RegExp(`^${pattern}$`, "i");
          }
          return {
            color: group.color,
            query,
            type: "file" as const,
            fileQuery,
            fileRegex,
          };
        } else {
          return {
            color: group.color,
            query,
            type: "text" as const,
          };
        }
      });
    // fork: a palette group expands in place (no flatMap — the lib target is es2018)
    this.preprocessedGroups = ([] as PreprocessedGroup[]).concat(...expanded).filter((g) => g.query !== "");
    this.groupsDirty = false;
  }

  private getNodeShape(node: GraphNode): NodeShape {
    switch (node.type) {
      case NodeType.Tag:
        return this.settings.tagShape;
      case NodeType.Attachment:
        return this.settings.attachmentShape;
      default:
        return this.settings.nodeShape;
    }
  }

  private getNodeSize(node: GraphNode): number {
    if (node.id === this.focusNodeId) return this.settings.nodeSize * 2.2; // fork: focused source
    switch (node.type) {
      case NodeType.Tag:
        return this.settings.tagNodeSize;
      case NodeType.Attachment:
        return this.settings.attachmentNodeSize;
      default:
        return this.settings.nodeSize;
    }
  }

  /** fork: the theme-aware highlight colour */
  private highlightColor(): string {
    return this.settings.useThemeColors
      ? this.getCssColor("--graph-node-focused", this.settings.colorHighlight)
      : this.settings.colorHighlight;
  }

  /** `forLabel` (fork): the colour a label carries — the node's own colour
   *  even while it is the hovered node (the label shows hover by a stronger
   *  tint of that colour), and without the time-grid period mix */
  private getNodeColor(node: GraphNode, forLabel = false): string {
    const { useThemeColors, colorNode, colorTag, colorAttachment } = this.settings;

    const hoveredSelf = forLabel && this.hoveredNode?.id === node.id && node.id !== this.selectedNode;
    if ((this.highlightedNodes.has(node.id) && !hoveredSelf) || node.id === this.focusNodeId) {
      return this.highlightColor();
    }

    // fork: notes in the hovered time-grid period — a partial highlight
    if (!forLabel && this.periodNodeIds.has(node.id)) {
      return mixColors(this.getNodeColor(node, true), this.highlightColor(), 0.45);
    }

    if (node.type === NodeType.Event) return this.settings.colorEvent; // fork: meetings

    for (const group of this.preprocessedGroups) {
      const { query, type } = group;

      if (type === "path") {
        if (node.type !== NodeType.Tag && node.id.toLowerCase().startsWith(group.pathQuery!)) {
          return group.color;
        }
      } else if (type === "tag") {
        const tagQuery = group.tagQuery!;
        if (node.type === NodeType.Tag && node.name.toLowerCase() === `#${tagQuery}`) {
          return group.color;
        }
        if (
          node.type === NodeType.File &&
          node.tags?.some((tag) => tag.toLowerCase() === tagQuery)
        ) {
          return group.color;
        }
      } else if (type === "prop") {
        if (node.type === NodeType.File && this.frontmatterMatches(node.id, group.propKey!, group.propValues!)) {
          return group.color;
        }
      } else if (type === "name") {
        if (node.type === NodeType.File && group.nameRegex!.test(node.name)) {
          return group.color;
        }
      } else if (type === "file") {
        if ((node.type === NodeType.File || node.type === NodeType.Attachment) && node.filename) {
          if (group.fileRegex) {
            if (group.fileRegex.test(node.filename)) {
              return group.color;
            }
          } else {
            if (node.filename.toLowerCase() === group.fileQuery!) {
              return group.color;
            }
          }
        }
      } else {
        let nodeContentLower = "";
        if (node.type === NodeType.File) {
          nodeContentLower = this.fileContentCache.get(node.id)?.lowerCaseContent || "";
        }
        if (node.name.toLowerCase().includes(query) || nodeContentLower.includes(query)) {
          return group.color;
        }
      }
    }

    if (useThemeColors) {
      if (node.type === NodeType.Tag) return this.getCssColor("--graph-tags", colorTag);
      if (node.type === NodeType.Attachment)
        return this.getCssColor("--graph-unresolved", colorAttachment);
      return this.getCssColor("--graph-node", colorNode);
    } else {
      if (node.type === NodeType.Tag) return colorTag;
      if (node.type === NodeType.Attachment) return colorAttachment;
      return colorNode;
    }
  }

  public updateDisplay() {
    if (!this.isGraphInitialized) return;
    this.updatePreprocessedGroups();
    this.updateColors();
  }

  /** fork: WASM engine parameters from the settings (link distance included —
   *  upstream left it at the engine's 30) */
  private physicsParams() {
    return {
      gravity: this.settings.centerForce,
      repulsion: this.settings.repelForce * 40.0,
      attraction: this.settings.linkForce,
      link_distance: this.settings.linkDistance,
    };
  }

  /** fork: one physics tick. The worker's buffer is copied into a buffer of
   *  the view's own: with SharedArrayBuffer the worker writes the next step
   *  into the shared one while the view still reads it (pointer picking,
   *  camera-driven label passes), and the ping-pong fallback hands the
   *  buffer back to the worker — detached, length 0 — right after this
   *  callback, so anything reading `currentPositions` between ticks saw an
   *  empty graph (labels hidden on camera moves, hover lost): flicker. */
  private onPhysicsTick(positions: Float32Array) {
    this.applyTimeline(positions);
    const own = this.currentPositions;
    let maxDelta = Infinity;
    if (own.length === positions.length) {
      maxDelta = 0;
      for (let i = 0; i < positions.length; i++) {
        const d = Math.abs(positions[i] - own[i]);
        if (d > maxDelta) maxDelta = d;
      }
      own.set(positions);
    } else {
      this.currentPositions = new Float32Array(positions);
    }
    const pos = this.currentPositions;
    this.updateStoryline(pos);
    this.updateTimelineGrid(pos);
    this.instancedRenderer?.updatePositions(pos);
    if (this.settings.showNodeLabels && !this.settings.performanceMode) {
      this.labelRenderer?.updateVisibilityAndOcclusion(
        this.graph.camera(),
        pos,
        this.settings,
        this.hoveredNode ? this.hoveredNode.id : null,
        this.highlightedNodes,
      );
    }
    this.handleKeyboardMovement();
    // fork fix (twitching): the bridge requested a new step after every tick
    // forever, and the timeline / 2D pull resets the engine's energy on each
    // sync, so it never counted as converged — the nodes kept being nudged.
    // Once nothing has moved more than SETTLE_EPS for SETTLE_TICKS ticks the
    // layout is at rest: stop stepping. Drag, settings and data changes wake it.
    this.settleTicks = maxDelta < Graph3DView.SETTLE_EPS ? this.settleTicks + 1 : 0;
    const settled = this.settleTicks >= Graph3DView.SETTLE_TICKS;
    if (settled) {
      this.settleTicks = 0;
      this.physicsBridge.stop();
    }
    if (this.fitAfterTicks > 0 && (--this.fitAfterTicks === 0 || settled)) {
      this.fitAfterTicks = 0;
      this.fitView(600);
    }
  }

  /** fork: frame every node, keeping the current viewing direction. The
   *  library's zoomToFit() measures its own node objects, which this plugin
   *  hides and never moves (positions live in the physics buffer), so it did
   *  nothing — the reset button and every "fit" after a scope change too. */
  public fitView(ms = 800) {
    const P = this.currentPositions, n = Math.min(this.currentNodes.length, P.length / 4);
    const cam = this.graph?.camera() as THREE.PerspectiveCamera | undefined;
    const controls = this.graph?.controls() as any;
    if (!cam || !controls?.target || n === 0) return;
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < n; i++) {
      lo.min(new THREE.Vector3(P[i * 4], P[i * 4 + 1], P[i * 4 + 2]));
      hi.max(new THREE.Vector3(P[i * 4], P[i * 4 + 1], P[i * 4 + 2]));
    }
    const centre = lo.clone().add(hi).multiplyScalar(0.5);
    const dir = cam.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    // half extents as seen along the viewing direction
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    let w = 0, h = 0, depth = 0;
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(P[i * 4], P[i * 4 + 1], P[i * 4 + 2]).sub(centre);
      w = Math.max(w, Math.abs(v.dot(right)));
      h = Math.max(h, Math.abs(v.dot(up)));
      depth = Math.max(depth, v.dot(dir));
    }
    const PAD = 25; // room for the labels round the outermost notes
    const tanV = Math.tan(((cam.fov || 50) * Math.PI) / 360);
    const aspect = cam.aspect || 1;
    const dist = Math.max((h + PAD) / tanV, (w + PAD) / (tanV * aspect), 40) * 1.08 + Math.max(0, depth);
    const pos = centre.clone().add(dir.multiplyScalar(dist));
    this.graph.cameraPosition({ x: pos.x, y: pos.y, z: pos.z }, { x: centre.x, y: centre.y, z: centre.z }, ms);
  }
  private static readonly SETTLE_EPS = 0.01; // world units per tick (a label is ~45 wide)
  private static readonly SETTLE_TICKS = 30;

  /** fork: resume a settled simulation */
  public wakePhysics() {
    if (!this.settings.useWasmPhysics) return;
    this.settleTicks = 0;
    this.physicsBridge.start();
  }

  public updateForces() {
    if (!this.isGraphInitialized) return;

    const { centerForce, repelForce, linkForce, useWasmPhysics } = this.settings;

    if (useWasmPhysics) {
      this.physicsBridge.setParams(this.physicsParams());
      this.wakePhysics();
    } else {
      if (this.centerForce) {
        this.centerForce.strength(centerForce);
      }
      if (this.chargeForce) {
        this.chargeForce.strength(-repelForce);
      }
      if (this.linkForce) {
        this.linkForce.strength(linkForce);
        this.linkForce.distance?.(this.settings.linkDistance); // fork
      }
    }
  }

  public updateControls() {
    if (!this.isGraphInitialized) return;
    const { rotateSpeed, panSpeed, zoomSpeed } = this.settings;
    const controls = this.graph.controls();
    if (controls) {
      controls.rotateSpeed = rotateSpeed;
      controls.noRotate = this.settings.flat2D; // fork: 2D mode — pan + zoom only
      controls.panSpeed = panSpeed;
      controls.zoomSpeed = zoomSpeed;
      if (!this.controlsListenerAdded) {
        let labelUpdatePending = false;
        controls.addEventListener("change", () => {
          if (!this.settings.showNodeLabels || this.settings.performanceMode) return;
          if (!labelUpdatePending) {
            labelUpdatePending = true;
            requestAnimationFrame(() => {
              this.updateLabels();
              labelUpdatePending = false;
            });
          }
        });
        this.controlsListenerAdded = true;
      }
    }
  }

  private updateLabels() {
    if (
      !this.isGraphInitialized ||
      !this.labelRenderer ||
      this.currentPositions.length === 0 ||
      !this.settings.showNodeLabels ||
      this.settings.performanceMode
    ) {
      if (this.labelRenderer?.instancedMesh) {
        this.labelRenderer.instancedMesh.visible = false;
      }
      return;
    }

    const camera = this.graph?.camera();
    if (!camera) return;

    this.labelRenderer.updateVisibilityAndOcclusion(
      camera,
      this.currentPositions,
      this.settings,
      this.hoveredNode ? this.hoveredNode.id : null,
      this.highlightedNodes,
    );
  }

  private handleNodeClick(node: GraphNode, event?: MouseEvent) {
    if (!node) return;

    if (event && (event.ctrlKey || event.metaKey)) {
      const target = node.type === NodeType.Event ? node.sourcePath! : node.id; // fork
      this.app.workspace.openLinkText(target, target, "tab");
      return;
    }

    if (this.clickTimeout) {
      clearTimeout(this.clickTimeout);
      this.clickTimeout = null;
      this.handleNodeDoubleClick(node);
    } else {
      this.clickTimeout = setTimeout(() => {
        this.handleNodeSingleClick(node);
        this.clickTimeout = null;
      }, this.CLICK_DELAY);
    }
  }

  private handleNodeDoubleClick(node: GraphNode) {
    if (node.type === NodeType.File || node.type === NodeType.Attachment || node.type === NodeType.Event) {
      const file = this.app.vault.getAbstractFileByPath(node.type === NodeType.Event ? node.sourcePath! : node.id);
      if (file instanceof TFile) this.app.workspace.getLeaf("tab").openFile(file);
    }
  }

  private handleNodeSingleClick(node: GraphNode) {
    if (this.selectedNode === node.id) {
      this.selectedNode = null;
      this.highlightedNodes.clear();
      this.highlightedLinks.clear();
    } else {
      this.selectedNode = node.id;
      this.highlightedNodes.clear();
      this.highlightedLinks.clear();
      this.highlightedNodes.add(node.id);

      const connectedLinks = this.linkAdjacencyIndex.get(node.id) || [];
      connectedLinks.forEach((link: ProcessedGraphLink) => {
        const sourceId =
          typeof link.source === "object" ? (link.source as GraphNode).id : (link.source as string);
        const targetId =
          typeof link.target === "object" ? (link.target as GraphNode).id : (link.target as string);

        this.highlightedNodes.add(sourceId);
        this.highlightedNodes.add(targetId);
        this.highlightedLinks.add(link);
      });

      if (this.settings.zoomOnClick) {
        const zoomDistance = 40;
        const idx = this.nodeIdToIndex.get(node.id);
        if (idx !== undefined && this.currentPositions.length > idx * 4) {
          this.reusableNodePosition.set(
            this.currentPositions[idx * 4],
            this.currentPositions[idx * 4 + 1],
            this.currentPositions[idx * 4 + 2],
          );
        } else {
          this.reusableNodePosition.set(node.x || 0, node.y || 0, node.z || 0);
        }
        const cameraPosition = this.graph.camera().position;
        this.reusableDirection.subVectors(cameraPosition, this.reusableNodePosition).normalize();
        this.reusableTargetPosition.addVectors(
          this.reusableNodePosition,
          this.reusableDirection.multiplyScalar(zoomDistance),
        );
        this.graph.cameraPosition(this.reusableTargetPosition, this.reusableNodePosition, 1000);
      }
    }
    this.updateNodeColorsDiff();
    this.updateLabels();
  }

  // fork: Obsidian page preview on node hover — the same contract Obsidian's
  // own 2D graph uses: targetEl null (the popover follows the pointer event),
  // and the view is the hoverParent, so it can tell the popover when the
  // pointer leaves the node.
  // fork: Obsidian hands the page preview to its hover parent through this
  // property; the setter tags it so the graph's previews can be styled apart
  // (no properties block unless asked — styles.css)
  private graphHoverPopover: any = null;
  get hoverPopover(): any {
    return this.graphHoverPopover;
  }
  set hoverPopover(pop: any) {
    this.graphHoverPopover = pop;
    const el: HTMLElement | undefined = pop?.hoverEl;
    if (!el) return;
    el.addClass("graph-3d-hover-preview");
    el.toggleClass("graph-3d-hide-properties", !this.settings.hoverPreviewProperties);
  }
  private lastHoverLink: string | null = null;

  private showHoverPreview(node: GraphNode, event: PointerEvent) {
    if (!this.plugin.settings.hoverPreview) return;
    if (node.type !== NodeType.File && node.type !== NodeType.Event) return;
    const link = node.type === NodeType.Event ? node.sourcePath! : node.id; // fork: the todo's note
    const pop = this.hoverPopover;
    if (pop && pop.state !== 0 /* not hidden */ && this.lastHoverLink === link) {
      pop.onTarget = true;
      pop.transition();
      return;
    }
    this.lastHoverLink = link;
    this.app.workspace.trigger("hover-link", {
      event,
      source: this.plugin.manifest.id,
      hoverParent: this,
      targetEl: null,
      linktext: link,
      sourcePath: "",
    });
  }

  private endHoverPreview() {
    const pop = this.hoverPopover;
    if (pop) {
      pop.onTarget = false;
      pop.transition();
    }
  }

  private handleNodeHover(node: GraphNode | null, event?: PointerEvent) {
    if (this.hoveredNode && this.hoveredNode !== node) {
      this.hoveredNode.fx = undefined;
      this.hoveredNode.fy = undefined;
      this.hoveredNode.fz = undefined;
    }

    this.hoveredNode = node;
    if (this.hoveredNode) {
      this.hoveredNode.fx = this.hoveredNode.x;
      this.hoveredNode.fy = this.hoveredNode.y;
      this.hoveredNode.fz = this.hoveredNode.z;
    }

    // fork: light up the hovered node's label too (in its own colour); a
    // node under the pointer takes priority over a time-grid frame
    if (node) this.setHoveredGridStop(null);
    this.refreshLabelHighlights();
    if (node && event) this.showHoverPreview(node, event);
    else this.endHoverPreview();

    this.highlightedNodes.clear();
    this.highlightedLinks.clear();

    if (node) {
      this.highlightedNodes.add(node.id);
      const connectedLinks = this.linkAdjacencyIndex.get(node.id) || [];
      connectedLinks.forEach((link: ProcessedGraphLink) => {
        this.highlightedLinks.add(link);
      });
    }
    this.updateNodeColorsDiff();
    this.updateLabels();
  }

  private updateNodeColorsDiff() {
    const nodesToUpdate = new Set<string>();
    this.lastHighlightedNodes.forEach((id) => nodesToUpdate.add(id));
    this.highlightedNodes.forEach((id) => nodesToUpdate.add(id));

    if (this.instancedRenderer) {
      const colorMap = new Map<number, string>();
      const labelColors = new Map<number, string>(); // fork
      nodesToUpdate.forEach((nodeId) => {
        const idx = this.nodeIdToIndex.get(nodeId);
        const node = this.nodeMap.get(nodeId);
        if (idx !== undefined && node) {
          colorMap.set(idx, this.getNodeColor(node));
          labelColors.set(idx, this.getNodeColor(node, true));
        }
      });
      this.instancedRenderer.updateNodeColors(colorMap);
      this.labelRenderer?.setNodeColors(labelColors);

      const linkHighlightColor = this.settings.useThemeColors
        ? this.getCssColor("--graph-node-focused", this.settings.colorHighlight)
        : this.settings.colorHighlight;
      const linkColor = this.settings.useThemeColors
        ? this.getCssColor("--graph-line", this.settings.colorLink)
        : this.settings.colorLink;

      const highlightedEdgeIndices = new Set<number>();
      this.highlightedLinks.forEach((linkObj) => {
        const idx = this.linkToIndex.get(linkObj as GraphLink);
        if (idx !== undefined) highlightedEdgeIndices.add(idx);
      });
      this.instancedRenderer.updateEdgeColors(highlightedEdgeIndices, linkHighlightColor, linkColor);
    }

    if (this.labelRenderer && this.currentPositions.length > 0) {
      this.labelRenderer.updateVisibilityAndOcclusion(
        this.graph.camera(),
        this.currentPositions,
        this.settings,
        this.hoveredNode ? this.hoveredNode.id : null,
        this.highlightedNodes,
      );
    }

    this.lastHighlightedNodes.clear();
    this.highlightedNodes.forEach((id) => this.lastHighlightedNodes.add(id));
  }

  private getLinkCurvature(link: ProcessedGraphLink) {
    if (this.settings.performanceMode) return 0;
    const sourceId =
      typeof link.source === "object" ? (link.source as GraphNode).id : (link.source as string);
    const targetId =
      typeof link.target === "object" ? (link.target as GraphNode).id : (link.target as string);
    const key = `${sourceId}->${targetId}`;
    if (this.reciprocalLinks.has(key)) {
      return sourceId > targetId ? 0.2 : -0.2;
    }
    return 0;
  }

  private matchesFilter(node: GraphNode, filter: Filter): boolean {
    const filterValue = filter.value.trim().toLowerCase();
    if (!filterValue) return false;

    if (filter.type === "path") {
      return node.id.toLowerCase().includes(filterValue);
    }
    if (filter.type === "tag") {
      const tagToMatch = filterValue.startsWith("#") ? filterValue.substring(1) : filterValue;
      if (node.type === NodeType.Tag) {
        return node.name.toLowerCase() === `#${tagToMatch}`;
      }
      // fork: a person hub carries the tags of its projects, but it's a person,
      // not project material — kept out of a tag (project) view unless asked
      if (!this.settings.showPeople && node.type === NodeType.File && this.isPersonNote(node.id)) return false;
      return node.tags?.some((tag) => tag.toLowerCase() === tagToMatch) ?? false;
    }
    return false;
  }

  private async processVaultData(): Promise<{
    nodes: GraphNode[];
    links: { source: string; target: string }[];
  } | null> {
    const { showAttachments, hideOrphans, showTags, searchQuery, showNeighboringNodes, filters } =
      this.settings;
    const allFiles = this.app.vault.getFiles();
    const resolvedLinks = this.app.metadataCache.resolvedLinks;
    if (!resolvedLinks) return null;

    const allNodesMap = new Map<string, GraphNode>();

    const allFilePaths = new Set(allFiles.map((f) => f.path));
    for (const path of this.processedNodes.keys()) {
      if (!allFilePaths.has(path)) {
        this.processedNodes.delete(path);
      }
    }
    for (const path of this.fileContentCache.keys()) {
      if (!allFilePaths.has(path)) {
        this.fileContentCache.delete(path);
      }
    }

    const needsContent =
      !!searchQuery ||
      this.preprocessedGroups.some((g) => {
        return g.type === "text";
      });

    const CONCURRENCY_LIMIT = 50;
    const readQueue = [...allFiles];
    const workers = Array(Math.min(CONCURRENCY_LIMIT, readQueue.length))
      .fill(null)
      .map(async () => {
        while (readQueue.length > 0) {
          const file = readQueue.shift()!;
          const cachedNodeInfo = this.processedNodes.get(file.path);

          let node: GraphNode;

          if (cachedNodeInfo && cachedNodeInfo.mtime === file.stat.mtime) {
            node = cachedNodeInfo.node;
            if (
              node.type === NodeType.File &&
              needsContent &&
              !this.fileContentCache.has(file.path)
            ) {
              const content = await this.app.vault.cachedRead(file);
              const lowerCaseContent = content.toLowerCase();
              this.fileContentCache.set(file.path, {
                mtime: file.stat.mtime,
                content,
                lowerCaseContent,
              });
            }
          } else {
            const cache = this.app.metadataCache.getFileCache(file);
            const tags = cache
              ? (getAllTags(cache) || []).map((t) => (t.startsWith("#") ? t.substring(1) : t))
              : [];
            // fork: `projekt: "#X"` / `delprojekt: "#X/sub"` count as tags, as on
            // the vault's hubs — so a project scope (tag filter) finds notes that
            // name their project only in frontmatter (e.g. assigned clippings)
            for (const t of projectTagsOf(cache?.frontmatter)) {
              if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t);
            }
            const type = file.extension === "md" ? NodeType.File : NodeType.Attachment;

            if (type === NodeType.File && needsContent) {
              const cachedContent = this.fileContentCache.get(file.path);
              if (!cachedContent || cachedContent.mtime !== file.stat.mtime) {
                const content = await this.app.vault.cachedRead(file);
                const lowerCaseContent = content.toLowerCase();
                this.fileContentCache.set(file.path, {
                  mtime: file.stat.mtime,
                  content,
                  lowerCaseContent,
                });
              }
            }

            node = {
              id: file.path,
              name: file.basename,
              filename: file.name,
              type,
              tags,
            };
            this.processedNodes.set(file.path, {
              node,
              mtime: file.stat.mtime,
            });
          }

          allNodesMap.set(file.path, node);
        }
      });
    await Promise.all(workers);

    const allLinks: { source: string; target: string }[] = [];
    const existingLinks = new Set<string>();
    const adjacency = new Map<string, string[]>();

    const addLink = (source: string, target: string) => {
      const linkKey = `${source}->${target}`;
      if (!existingLinks.has(linkKey)) {
        existingLinks.add(linkKey);
        allLinks.push({ source, target });

        let srcAdj = adjacency.get(source);
        if (!srcAdj) {
          srcAdj = [];
          adjacency.set(source, srcAdj);
        }
        srcAdj.push(target);

        let tgtAdj = adjacency.get(target);
        if (!tgtAdj) {
          tgtAdj = [];
          adjacency.set(target, tgtAdj);
        }
        tgtAdj.push(source);
      }
    };

    for (const sourcePath in resolvedLinks) {
      const targets = resolvedLinks[sourcePath];
      for (const targetPath in targets) {
        addLink(sourcePath, targetPath);
      }
    }

    for (const file of allFiles) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.frontmatterLinks) {
        for (const linkCache of cache.frontmatterLinks) {
          const destFile = this.app.metadataCache.getFirstLinkpathDest(linkCache.link, file.path);
          if (destFile) {
            addLink(file.path, destFile.path);
          }
        }
      }
    }

    if (showTags) {
      allNodesMap.forEach((node) => {
        if (node.type === NodeType.File && node.tags) {
          for (let i = 0; i < node.tags.length; i++) {
            const tagName = node.tags[i];
            const tagId = `tag:${tagName}`;
            if (!allNodesMap.has(tagId)) {
              allNodesMap.set(tagId, {
                id: tagId,
                name: `#${tagName}`,
                type: NodeType.Tag,
              });
            }
            addLink(node.id, tagId);
          }
        }
      });
    }

    const allNodes = Array.from(allNodesMap.values());
    const activeFilters = filters.filter((f) => f.enabled && f.value.trim() !== "");
    const hasActiveFilters = activeFilters.length > 0;
    const lowerCaseSearch = searchQuery ? searchQuery.toLowerCase() : "";

    const isNodeMatch = (node: GraphNode): boolean => {
      if (hasActiveFilters) {
        let filterPassed = false;
        for (let i = 0; i < activeFilters.length; i++) {
          if (this.matchesFilter(node, activeFilters[i])) {
            filterPassed = true;
            break;
          }
        }
        if (!filterPassed) return false;
      }

      if (lowerCaseSearch) {
        let nodeContentLower = "";
        if (node.type === NodeType.File) {
          nodeContentLower = this.fileContentCache.get(node.id)?.lowerCaseContent || "";
        }
        const matches =
          node.name.toLowerCase().includes(lowerCaseSearch) ||
          (node.type !== NodeType.Tag && node.id.toLowerCase().includes(lowerCaseSearch)) ||
          nodeContentLower.includes(lowerCaseSearch);
        if (!matches) return false;
      }

      return true;
    };

    // fork: the tag the graph is filtered on (e.g. #STOPP for the STOPP
    // project) is hidden unless asked for: every note links to it, so it
    // pulls them all into one knot. Notes then hang together only through
    // their own links (sub-tags like #STOPP/kosmetika stay).
    const scopeTags = new Set(
      this.settings.showScopeTag
        ? []
        : activeFilters
            .filter((f) => f.type === "tag")
            .map((f) => `#${f.value.trim().replace(/^#/, "").toLowerCase()}`),
    );
    const isTypeVisible = (node: GraphNode): boolean => {
      if (node.type === NodeType.Tag) return showTags && !scopeTags.has(node.name.toLowerCase());
      if (node.type === NodeType.Attachment) return showAttachments;
      return true;
    };

    const hasFilterOrSearch = hasActiveFilters || Boolean(lowerCaseSearch);
    const visibleNodeIds = new Set<string>();

    if (hasFilterOrSearch) {
      const matchedNodeIds: string[] = [];
      for (let i = 0; i < allNodes.length; i++) {
        const node = allNodes[i];
        if (isNodeMatch(node)) {
          matchedNodeIds.push(node.id);
          if (isTypeVisible(node)) {
            visibleNodeIds.add(node.id);
          }
        }
      }

      if (showNeighboringNodes) {
        for (let i = 0; i < matchedNodeIds.length; i++) {
          const neighbors = adjacency.get(matchedNodeIds[i]);
          if (neighbors) {
            for (let j = 0; j < neighbors.length; j++) {
              const neighborId = neighbors[j];
              const neighborNode = allNodesMap.get(neighborId);
              if (neighborNode && isTypeVisible(neighborNode)) {
                visibleNodeIds.add(neighborId);
              }
            }
          }
        }
      }
    } else {
      for (let i = 0; i < allNodes.length; i++) {
        const node = allNodes[i];
        if (isTypeVisible(node)) {
          visibleNodeIds.add(node.id);
        }
      }
    }

    const linksToShow: { source: string; target: string }[] = [];
    const connectedNodeIds = hideOrphans ? new Set<string>() : null;

    for (let i = 0; i < allLinks.length; i++) {
      const link = allLinks[i];
      if (visibleNodeIds.has(link.source) && visibleNodeIds.has(link.target)) {
        linksToShow.push(link);
        if (connectedNodeIds) {
          connectedNodeIds.add(link.source);
          connectedNodeIds.add(link.target);
        }
      }
    }

    const nodesToShow: GraphNode[] = [];
    for (const nodeId of visibleNodeIds) {
      if (!connectedNodeIds || connectedNodeIds.has(nodeId)) {
        const node = allNodesMap.get(nodeId);
        if (node) nodesToShow.push(node);
      }
    }

    if (this.settings.showEvents) await this.addEventNodes(nodesToShow, linksToShow);

    return { nodes: nodesToShow, links: linksToShow };
  }

  // ---- fork: meetings as events ------------------------------------------
  // A meeting is a todo line carrying the event tag (default `#röd`) and a due
  // date. Each one becomes a node of its own, linked to the note it lives in
  // and dated by its due date, so it sits at the right height on the timeline.
  // A möte note (`typ: möte`, named `<meeting timestamp> … <todo text>`) for
  // the same day and text stands in for the todo — no second node then.

  /** compare key for a meeting's text: lower case, letters and digits only */
  private static meetingKey(day: string, text: string): string {
    return day + "|" + text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  }

  private async addEventNodes(nodes: GraphNode[], links: { source: string; target: string }[]) {
    const tag = "#" + this.settings.eventTag.replace(/^#/, "").trim().toLowerCase();
    if (tag === "#") return;
    const tagRe = new RegExp(`(^|\\s)${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_/-])`, "iu");
    const dueRe = /\[due::\s*(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?\s*\]|📅\s*(\d{4})-(\d{2})-(\d{2})/u;

    const covered = new Set<string>(); // meetings that already have a möte note
    for (const n of nodes) {
      if (n.type !== NodeType.File) continue;
      const f = this.app.vault.getAbstractFileByPath(n.id);
      if (!(f instanceof TFile)) continue;
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      const typ = String(fm?.typ ?? fm?.type ?? "").toLowerCase();
      const m = /^(\d{8})\d{0,6}\s+(.*)$/.exec(f.basename);
      if ((typ === "möte" || typ === "mote") && m) {
        covered.add(Graph3DView.meetingKey(m[1], String(fm?.fritext || m[2])));
      }
    }

    const fileNodes = nodes.filter((n) => n.type === NodeType.File);
    for (const n of fileNodes) {
      const f = this.app.vault.getAbstractFileByPath(n.id);
      if (!(f instanceof TFile)) continue;
      const cache = this.app.metadataCache.getFileCache(f);
      if (!cache?.listItems?.some((li) => li.task !== undefined)) continue;
      if (!(cache.tags || []).some((t) => t.tag.toLowerCase() === tag)) continue;
      const lines = (await this.app.vault.cachedRead(f)).split("\n");
      for (const li of cache.listItems) {
        if (li.task === undefined) continue;
        const line = lines[li.position.start.line] || "";
        if (!tagRe.test(line)) continue;
        const d = dueRe.exec(line);
        if (!d) continue;
        const [y, mo, da] = d[1] ? [d[1], d[2], d[3]] : [d[6], d[7], d[8]];
        const date = new Date(+y, +mo - 1, +da, +(d[4] || 0), +(d[5] || 0)).getTime();
        if (isNaN(date)) continue;
        const text = line
          .replace(/^\s*[-*+]\s+\[.\]\s*/, "")
          .replace(/\[[^\]:]+::[^\]]*\]|\([^)\s:]+::[^)]*\)/g, "") // [due:: …] (id:: …)
          .replace(/\[[^\]]*\]\([^)]*\)/g, "")                       // [⏰](x-apple-reminder://…)
          .replace(/[📅✅⏳🛫]\s*\d{4}-\d{2}-\d{2}/gu, "")
          .replace(/📍.*$/u, "")                                         // location runs to the end
          .replace(/(^|\s)#[^\s#]+/gu, " ")
          .replace(/\s+/g, " ")
          .trim();
        const day = `${y}${mo}${da}`;
        if (!text || covered.has(Graph3DView.meetingKey(day, text))) continue;
        const short = new Date(date).toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
        const id = `event:${f.path}#${li.position.start.line}`;
        nodes.push({ id, name: `${short} ${text}`, type: NodeType.Event, sourcePath: f.path, date });
        links.push({ source: f.path, target: id });
      }
    }
  }

  private cleanupNode(
    node: GraphNode,
    options: { cleanMesh?: boolean; cleanGroup?: boolean } = {
      cleanMesh: true,
      cleanGroup: true,
    },
  ) {
    if (options.cleanMesh) {
      this.nodeMeshes.delete(node);
    }

    if (options.cleanGroup && node.__threeObj) {
      node.__threeObj.parent?.remove(node.__threeObj);
    }
  }

  async onClose() {
    this.physicsBridge.dispose();
    if (this.clickTimeout) clearTimeout(this.clickTimeout);
    this.resizeObserver?.disconnect();
    if (this.graph) {
      this.graph.graphData().nodes.forEach((node: GraphNode) => this.cleanupNode(node));
      this.isGraphInitialized = false;
      this.graph.pauseAnimation();
      const renderer = this.graph.renderer();
      if (renderer?.domElement) {
        renderer.forceContextLoss();
        renderer.dispose();
      }
      if (typeof this.graph._destructor === "function") {
        this.graph._destructor();
      }
      this.graph = null;
    }
    if (this.instancedRenderer) {
      this.instancedRenderer.clear();
      this.instancedRenderer = null;
    }
    if (this.labelRenderer) {
      this.labelRenderer.clear();
      this.labelRenderer = null;
    }
    if (this.messageEl) {
      this.messageEl.remove();
    }
    if (this.counterEl) {
      this.counterEl.remove();
    }
    this.clearResourceCaches();
    if (this.colorResolverEl) {
      this.colorResolverEl.remove();
      this.colorResolverEl = null;
    }
    this.colorCanvasCtx = null;
    this.colorCache.clear();
    this.processedNodes.clear();
    this.nodeMap.clear();
    this.reciprocalLinks.clear();
    this.linkAdjacencyIndex.clear();
    this.lastHighlightedNodes.clear();
    this.controlsListenerAdded = false;
  }
}
