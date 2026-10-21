import { Notice, Plugin, TAbstractFile, TFile, TFolder, debounce } from "obsidian";
import { Graph3DPluginSettings, DEFAULT_SETTINGS, type Filter } from "./src/types";
import { Graph3DView, VIEW_TYPE_3D_GRAPH } from "./src/view";
import { Graph3DSettingsTab } from "./src/settings";
import VaultStruktur from "./src/fork/vault_struktur"; // fork: the vault tree contract (vendored library)
import { scopeFilters } from "./src/fork/scope"; // fork: the pure scope rules of "Open in 3D graph"
import { parseGraphBlock } from "./src/fork/analog"; // fork: the ```3d-graf block (pure)

export default class Graph3DPlugin extends Plugin {
	settings: Graph3DPluginSettings;
	/** fork: the parsed .obsidian/vault-struktur.json (null while the vault has none) */
	private forkContract: VaultStruktur.Config | null = null;

	async onload() {
		await this.loadSettings();
		this.forkContract = await this.readForkContract(); // fork: the tree contract, read at load
		this.registerView(
			VIEW_TYPE_3D_GRAPH,
			(leaf) => new Graph3DView(leaf, this),
		);
		this.addSettingTab(new Graph3DSettingsTab(this.app, this));
		// fork: page preview on node hover (no modifier key by default;
		// configurable under Settings → Page preview)
		this.registerHoverLinkSource(this.manifest.id, {
			display: "3D Graph",
			defaultMod: false,
		});
		this.addRibbonIcon("network", "Open 3d graph", () =>
			this.activateView(),
		);

		this.addCommand({
			id: "toggle-newest-top",
			name: "Reverse timeline (newest at the top ↔ bottom)",
			hotkeys: [{ modifiers: ["Mod", "Alt"], key: "L" }],
			callback: () => {
				this.app.workspace
					.getLeavesOfType(VIEW_TYPE_3D_GRAPH)
					.forEach((leaf) => {
						if (leaf.view instanceof Graph3DView) leaf.view.toggleNewestTop();
					});
			},
		});

		// fork: timeline direction and shape (no default hotkeys — bind your own)
		const eachView = (fn: (v: Graph3DView) => unknown) =>
			this.app.workspace.getLeavesOfType(VIEW_TYPE_3D_GRAPH).forEach((leaf) => {
				if (leaf.view instanceof Graph3DView) fn(leaf.view);
			});
		this.addCommand({
			id: "toggle-timeline-direction",
			name: "Timeline: vertical ↔ horizontal",
			callback: () =>
				eachView((v) => v.setTimelineForm({ axis: this.settings.timelineAxis === "horizontal" ? "vertical" : "horizontal" })),
		});
		this.addCommand({
			id: "toggle-timeline-line",
			name: "Timeline: spread ↔ straight line",
			callback: () => eachView((v) => v.setTimelineForm({ shape: this.settings.timelineShape === "line" ? "spread" : "line" })),
		});

		this.addCommand({
			id: "toggle-2d",
			name: "Toggle 2D mode",
			hotkeys: [{ modifiers: ["Mod", "Alt"], key: "P" }],
			callback: () => {
				this.app.workspace
					.getLeavesOfType(VIEW_TYPE_3D_GRAPH)
					.forEach((leaf) => {
						if (leaf.view instanceof Graph3DView) leaf.view.toggleFlat2D();
					});
			},
		});

		this.addCommand({
			id: "cycle-presentation",
			name: "Next presentation (network → timeline → storyline)",
			hotkeys: [{ modifiers: ["Mod", "Alt"], key: "G" }],
			callback: () => {
				this.app.workspace
					.getLeavesOfType(VIEW_TYPE_3D_GRAPH)
					.forEach((leaf) => {
						if (leaf.view instanceof Graph3DView) leaf.view.cyclePresentation();
					});
			},
		});

		// fork: open a folder, hub or note in the graph — right-click in the
		// file list, or the active note via the command (bind a hotkey to it)
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFolder) && !(file instanceof TFile && file.extension === "md")) return;
				menu.addItem((item) =>
					item
						.setTitle("Open in 3D graph")
						.setIcon("network")
						.onClick(() => this.showInGraph(file)),
				);
			}),
		);
		this.addCommand({
			id: "show-active-in-graph",
			name: "Show active note in 3D graph (its project, highlighted)",
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "G" }], // fork default; change in Settings → Hotkeys
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) this.showInGraph(file);
				return true;
			},
		});

		// fork (analog view): the analog notes as a timeline of thumbnails, preview docked lower right.
		// Command id `new-3d-graph-tiramisioux:open-analog` — the note-ingest hub links to it.
		this.addCommand({
			id: "open-analog",
			name: "Visa analoga anteckningar i 3D",
			callback: () =>
				this.openScope({
					filters: [
						{ type: "prop", value: "typ=analog anteckning", enabled: true },
						{ type: "prop", value: "sidtyp=tom", enabled: true, negate: true },
					],
					neighbors: true,
					focusId: null,
					options: { timeline: true, thumbnails: true, docked: true },
				}),
		});

		// fork: ```3d-graf — one button that opens a scope in the graph:
		//   filter: prop: typ=analog anteckning   (repeatable; path: / tag: / prop: / !prop: …)
		//   tidslinje: på   miniatyrer: på   grannar: på|av   knapp: Visa i 3D
		this.registerMarkdownCodeBlockProcessor("3d-graf", (source, el) => {
			const spec = parseGraphBlock(source);
			if (spec.errors.length) {
				el.createEl("div", { cls: "setting-item-description", text: `3d-graf: förstår inte ${spec.errors.map((e) => `"${e}"`).join(", ")}` });
			}
			const button = el.createEl("button", { cls: "mod-cta", text: spec.label });
			button.addEventListener("click", () => {
				if (!spec.filters.length) {
					new Notice("3d-graf: ingen filter-rad");
					return;
				}
				void this.openScope({
					filters: spec.filters as Filter[],
					neighbors: spec.neighbors,
					focusId: null,
					options: { timeline: spec.timeline || undefined, thumbnails: spec.thumbnails || undefined, docked: spec.thumbnails || undefined },
				});
			});
		});

		this.addCommand({
			id: "open-3d-graph-view",
			name: "Open 3d graph",
			callback: () => {
				this.activateView();
			},
		});

		const debouncedUpdate = debounce(
			() => this.triggerLiveUpdate(),
			300,
			false,
		);
		this.registerEvent(this.app.vault.on("create", debouncedUpdate));
		this.registerEvent(this.app.vault.on("delete", debouncedUpdate));
		this.registerEvent(this.app.vault.on("modify", debouncedUpdate));
		this.registerEvent(
			this.app.metadataCache.on("resolve", debouncedUpdate),
		);
	}

	/** fork: read .obsidian/vault-struktur.json; null when it is missing or not JSON */
	private async readForkContract(): Promise<VaultStruktur.Config | null> {
		try {
			return JSON.parse(await this.app.vault.adapter.read(this.app.vault.configDir + "/vault-struktur.json"));
		} catch {
			return null;
		}
	}

	/**
	 * fork: what to show for a folder / hub / note — the rules live in src/fork/scope.js
	 * (pure, tested with `node tests/scope.test.mjs`) on top of the vault's tree contract.
	 * Returns null while the vault has no contract file.
	 */
	async scopeFor(file: TAbstractFile): Promise<{ filters: Filter[]; neighbors: boolean; focusId: string | null } | null> {
		this.forkContract = this.forkContract ?? await this.readForkContract();
		if (!this.forkContract) {
			new Notice("vault-struktur.json saknas — väntar på omstruktureringen");
			return null;
		}
		const listDir = (rel: string): VaultStruktur.DirEntry[] | null => {
			const f = rel ? this.app.vault.getAbstractFileByPath(rel) : this.app.vault.getRoot();
			return f instanceof TFolder ? f.children.map((c) => ({ name: c.name, dir: c instanceof TFolder })) : null;
		};
		let vs: VaultStruktur.Struktur;
		try {
			vs = VaultStruktur.from_config(this.forkContract, listDir);
		} catch (e) {
			new Notice(e instanceof Error ? e.message : String(e));
			return null;
		}
		const isFolder = file instanceof TFolder;
		const fm = isFolder ? undefined : this.app.metadataCache.getFileCache(file as TFile)?.frontmatter;
		const r = scopeFilters(file.path, isFolder, String(fm?.projekt ?? ""), vs);
		return { filters: r.filters as Filter[], neighbors: r.neighbors, focusId: r.focusPath };
	}

	async showInGraph(file: TAbstractFile) {
		const scope = await this.scopeFor(file);
		if (!scope) return;
		await this.activateView();
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_3D_GRAPH)[0];
		if (leaf?.view instanceof Graph3DView) await leaf.view.showScope(scope);
	}

	/** fork: open the graph view and show a scope (filters + optional switches) in it */
	async openScope(scope: Parameters<Graph3DView["showScope"]>[0]) {
		await this.activateView();
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_3D_GRAPH)[0];
		if (leaf?.view instanceof Graph3DView) await leaf.view.showScope(scope);
	}

	triggerLiveUpdate() {
		this.app.workspace
			.getLeavesOfType(VIEW_TYPE_3D_GRAPH)
			.forEach((leaf) => {
				if (leaf.view instanceof Graph3DView) {
					leaf.view.updateData();
				}
			});
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.app.workspace
			.getLeavesOfType(VIEW_TYPE_3D_GRAPH)
			.forEach((leaf) => {
				if (leaf.view instanceof Graph3DView) {
					leaf.view.setGroupsDirty();
					leaf.view.onSettingsSaved(); // fork: switch panel + wake settled physics
				}
			});
	}

	async activateView() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_3D_GRAPH);
		if (leaves.length > 0) {
			this.app.workspace.revealLeaf(leaves[0]);
			return;
		}
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_3D_GRAPH, active: true });
		this.app.workspace.revealLeaf(leaf);
	}
}
