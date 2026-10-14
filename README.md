# 3D Graph for Obsidian — Tiramisioux fork

A fork of [**New 3D Graph**](https://github.com/Apoo711/obsidian-3d-graph) by Aryan Gupta, with fixes and extra ways to present your vault. Everything from the original works the same; this fork adds what's listed below.

> **Plugin id:** `new-3d-graph-tiramisioux` · **name in Obsidian:** *New 3D Graph (Tiramisioux fork)* · **based on:** 2.8.1
> It has its own id on purpose: a community-store update of the original can never overwrite it.

## What this fork adds

| | Feature | How to use it |
|---|---|---|
| 🐞 | **Labels that actually show** | Fixed: with a filter or a small graph, node labels were invisible, and in large graphs they could show the wrong names. Nothing to set. ([reported upstream: #16](https://github.com/Apoo711/obsidian-3d-graph/issues/16)) |
| ✂️ | **Shorter labels** | *Settings → Strip from label (regex)* removes a pattern from note labels, e.g. a Zettelkasten timestamp; *Underscores as spaces* tidies the rest. Search still matches the full file name; tag labels are left alone. |
| 👁 | **Page preview on hover** | Hover a note node to see Obsidian's page preview. Needs the core *Page preview* plugin. Turn it off under *Settings → Page preview on hover*, or require a modifier key under *Settings → Page preview → 3D Graph*. |
| 🕰 | **Timeline layout** | Notes are pulled **vertically by date** — oldest at the top, newest at the bottom (or the other way with *Newest at the top*). Links still cluster related notes, so it's a rough timeline, not a ruler. |
| 🧵 | **Storyline** | A thin line threads through the notes in date order, so you can follow the story from first note to last. |
| 🔀 | **Presentation switch** | A button in the graph's top-right toolbar (and the command *Next presentation*) steps through **Network → Timeline → Timeline + storyline**. |

### Example: Zettelkasten file names

File names like `20261014104013 RISE UND inspo_verksamhetslogik` become the label **inspo verksamhetslogik** with:

- *Strip from label (regex):* `^\d{14}\s+(?:[A-ZÅÄÖ0-9_]+\s+){0,2}` — the 14-digit timestamp and up to two ALL-CAPS words (context, project)
- *Underscores as spaces:* on

Handy together with a tag filter: when you filter on a project, its name is implied, so it doesn't need to be on every label.

### How a note's date is found (timeline + storyline)

1. a `YYYYMMDD` / `YYYYMMDDHHmmss` prefix in the file name,
2. otherwise the frontmatter property `datum` or `date`,
3. otherwise the file's creation date.

Tags have no date and aren't pulled; attachments are pulled but not part of the storyline.

## Settings added by the fork

| Setting | Where | Default |
|---|---|---|
| Strip from label (regex) | Settings → Labels | *(empty)* |
| Underscores as spaces in labels | Settings → Labels | off |
| Page preview on hover | Settings → Interaction | on |
| Timeline layout · Newest at the top · Timeline strength · Timeline length · Storyline | graph view ⚙ → *Timeline* | off · off · 0.08 · 600 · off |

## Install

1. Build it (below) or take `main.js`, `manifest.json` and `styles.css` from a release.
2. Copy the three files into `<your vault>/.obsidian/plugins/new-3d-graph-tiramisioux/`.
3. Settings → Community plugins → enable **New 3D Graph (Tiramisioux fork)**.
4. **Disable the original *New 3D Graph*** — both register the same view, so only one should be on.
5. Optional: copy the original's `data.json` into the fork's folder to keep your settings and filters.

## Updates and upstream

- The fork isn't in the community store; update it by pulling this repo and rebuilding.
- Upstream changes from [Apoo711/obsidian-3d-graph](https://github.com/Apoo711/obsidian-3d-graph) are merged by hand (`git fetch upstream && git merge upstream/main`).
- Fork work lives on the default branch `tiramisioux`; `main` follows upstream.

## Building

```bash
npm ci
npx tsc -noEmit -skipLibCheck && node esbuild.config.mjs production
```

The Rust/WASM physics engine is prebuilt in `src/physics/wasm-data.ts`; `wasm-pack` (`npm run build`) is only needed when changing `crates/`.

Fork changes, by file: label fix + label formatting in `src/rendering/label-renderer.ts`; page preview, timeline, storyline and the presentation switch in `src/view.ts`; new settings in `src/types.ts` / `src/settings.ts`; hover source and command in `main.ts`.

---

## Original README (upstream)


![hero](assets/hero.png)

A plugin for Obsidian that provides a high-performance 3D, force-directed graph view of your vault. Powered by a custom **Rust + WebAssembly** physics engine with **128-bit SIMD** acceleration, it offers an immersive, fluid way to visualize and explore thousands of note connections.

---

💡 _Check out my blog post [here](https://aryan-gupta.is-a.dev/blog/2025-06-24-3d-graph-plugin/)_

---

## Why Choose This 3D Graph?

While other 3D graph plugins exist, this one is built for **extreme performance and deep customization**:

- **Blazing Fast Rust WASM Physics Engine**: Physics calculations are offloaded to a dedicated Web Worker running a **Rust WebAssembly engine with 128-bit SIMD intrinsics** and a **3D Barnes-Hut Octree ( $O(N \log N)$ )**. Handles 50,000+ nodes and edges effortlessly at 60+ FPS while keeping camera rotation buttery smooth.
- **Unparalleled Customization**: Granular control over your graph's appearance and physics. Independently customize shapes, sizes, and colors for notes, attachments, and tags. Fine-tune repulsion, attraction, gravity, and damping with live sliders.
- **Zero-Copy & Energy Efficient**: Zero-copy array buffer transfers eliminate GC pauses. Automatic kinetic energy cooling pauses physics calculations when the layout reaches equilibrium to save 100% CPU when idle.
- **Powerful Filtering & Coloring**: Visually organize your vault with `path:`, `tag:`, `file:`, and text queries to create custom color-coded groups, filter tags/attachments/orphans, and highlight neighbor connections.

---

## Key Features

- **Interactive 3D Canvas:** Pan, zoom, and rotate around your notes from any angle with responsive WASD keyboard controls.
- **Node Interaction:**
    - **Single-click** a node to focus the camera and highlight immediate links.
    - **Double-click** a node to open it in a new tab.
    - **Drag & Drop** nodes in 3D space to re-anchor layout positions live.
- **Rust WASM Physics Backend:**
    - Off-thread simulation tick loop running inside a Web Worker.
    - Instant parameter updates and zero-copy position synchronization.
- **Advanced Filtering & Search:**
    - **Live Search:** Instant query filtering for notes and neighboring connections.
    - **Live Filters:** On-the-fly toggles for attachments, tags, and orphan nodes.
- **Deep Customization:**
    - **Color Groups:** Rule-based styling with `path:`, `tag:`, `file:`, or content matching.
    - **Node Appearance:** Custom shapes (Sphere, Cube, Pyramid, Tetrahedron) and sizing.
    - **Physics Controls:** Tweak Center force, Repel force, Link force, and WASM engine mode.

![Demo Video](assets/output.gif)

---

## How to Install

### Recommended Method (Community Plugins)

1. Open **Settings > Community plugins**.
2. Turn **Restricted mode** OFF.
3. Click **Browse** and search for **"New 3D Graph"**.
4. Click **Install**, then **Enable**.

### Beta Installation (via BRAT)

1. Install the **BRAT** plugin from Community Plugins.
2. Open BRAT settings (`Settings` > `BRAT`).
3. Click **Add Beta plugin** and enter `Apoo711/obsidian-3d-graph`.
4. Enable **3D Graph** in Community Plugins.

Open the 3D Graph from the ribbon icon on the left sidebar or using the Command Palette (`Ctrl/Cmd + P` $\rightarrow$ _"Open 3D Graph"_).

---

## Settings Overview

Go to `Settings` > `3D Graph Plugin` or use the in-graph floating settings gear icon:

- **Search & Filters:** Search term matching, neighboring node inclusion, and tag/attachment/orphan toggles.
- **Color Groups:** Custom color assignment rules using `path:`, `tag:`, and `file:`.
- **Appearance & Display:** Custom geometry shapes, sizes, colors, and label visibility distance.
- **Interaction:** Keyboard navigation (WASD), zoom speed, pan speed, and rotation sensitivity.
- **Forces:** Adjust Repel force, Link force, Center force, and toggle **"Use Rust WASM Physics Engine"**.

---

## Acknowledgements

- **Rust & WebAssembly**: High-performance physics core using `glam` SIMD vector math, `wasm-bindgen`, and `wasm-opt`.
- **Three.js**: 3D scene rendering, lighting, and GPU instancing.
- Built with ❤️ for the Obsidian community.
