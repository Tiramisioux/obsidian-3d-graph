import { Plugin, TAbstractFile, TFile, TFolder, debounce } from "obsidian";
import { Graph3DPluginSettings, DEFAULT_SETTINGS, type Filter } from "./src/types";
import { Graph3DView, VIEW_TYPE_3D_GRAPH } from "./src/view";
import { Graph3DSettingsTab } from "./src/settings";

export default class Graph3DPlugin extends Plugin {
	settings: Graph3DPluginSettings;

	async onload() {
		await this.loadSettings();
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

		this.addCommand({
			id: "toggle-2d",
			name: "Toggle 2D mode",
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

	/**
	 * fork: what to show for a folder / hub / note.
	 * - folder → everything under it (path filter)
	 * - note or hub with a `projekt: "#X"` frontmatter → its project (tag X),
	 *   the note highlighted — the same scope a hub's own aggregator uses
	 * - note under 03_PROJEKTPLANERING/<CTX>/<PROJ>/ without `projekt` → that
	 *   project folder, highlighted
	 * - any other note → the note and its linked neighbours, highlighted
	 */
	scopeFor(file: TAbstractFile): { filters: Filter[]; neighbors: boolean; focusId: string | null } {
		if (file instanceof TFolder) {
			return { filters: [{ type: "path", value: `${file.path}/`, enabled: true }], neighbors: false, focusId: null };
		}
		const fm = this.app.metadataCache.getFileCache(file as TFile)?.frontmatter;
		const projekt = String(fm?.projekt ?? "").trim().replace(/^#/, "");
		if (projekt) {
			return { filters: [{ type: "tag", value: projekt, enabled: true }], neighbors: false, focusId: file.path };
		}
		const m = /^(03_PROJEKTPLANERING\/[^/]+\/[^/]+\/)/.exec(file.path);
		if (m) return { filters: [{ type: "path", value: m[1], enabled: true }], neighbors: false, focusId: file.path };
		return { filters: [{ type: "path", value: file.path, enabled: true }], neighbors: true, focusId: file.path };
	}

	async showInGraph(file: TAbstractFile) {
		await this.activateView();
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_3D_GRAPH)[0];
		if (leaf?.view instanceof Graph3DView) await leaf.view.showScope(this.scopeFor(file));
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
