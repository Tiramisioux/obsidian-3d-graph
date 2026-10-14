# 3D Graph for Obsidian — Tiramisioux fork

A fork of [**New 3D Graph**](https://github.com/Apoo711/obsidian-3d-graph) by Aryan Gupta, with fixes and extra ways to present your vault. Everything from the original works the same; this fork adds what's listed below.

> **Plugin id:** `new-3d-graph-tiramisioux` · **name in Obsidian:** *New 3D Graph (Tiramisioux fork)* · **version:** 2.8.1-tiramisioux.12 · **based on:** 2.8.1
> It has its own id on purpose: a community-store update of the original can never overwrite it.

## What this fork adds

| | Feature | How to use it |
|---|---|---|
| 🐞 | **Labels that actually show** | Fixed: with a filter or a small graph, node labels were invisible, and in large graphs they could show the wrong names. Nothing to set. ([reported upstream: #16](https://github.com/Apoo711/obsidian-3d-graph/issues/16)) |
| ✂️ | **Shorter labels** | *Settings → Strip from label (regex)* removes a pattern from note labels, e.g. a Zettelkasten timestamp; *Underscores as spaces* tidies the rest. Search still matches the full file name; tag labels are left alone. |
| 🏷 | **Label cards that don't blur together** | Each label is a rounded card with a faint outline (*Settings → Label border opacity*), and a nearer label covers a farther one instead of the texts mixing. Set *Label Background Opacity* to 1 for fully opaque cards. The label settings (size, colours, opacity) now apply immediately instead of after a reload. |
| 🎨 | **Labels in their note's colour** | Each label's card is faintly tinted with its node's colour — the same colour the node gets from colour groups, note types, meetings or the focus highlight — and its outline takes that colour too. Hovering makes the tint clearly stronger. White nodes keep a plain card. The text stays dark on light cards (light on dark ones), whatever the tint. Strengths: *Settings → Label tint* (0.15) and *Label tint on hover* (0.45). |
| 📏 | **Room for the labels** | New default spacing so neighbouring labels overlap far less: neighbours sit about one label width (~45 units, a 22-character line) apart instead of ~24. *Center force* 0.1 → 0.02, *Repel force* 10 → 20 (slider now up to 40), new *Link distance* 50 (the engine used a fixed 30), *Label distance* 150 → 300 so labels still show in the bigger layout. Existing vaults keep their stored values — set them under *Settings → Forces*. |
| ↔️ | **Labels kept apart** | Spacing alone can't separate labels on the timeline: every note's height is fixed by its date, so notes from the same week share a band. While two labels overlap, their notes are now pushed apart **sideways** (half each), never up or down — the date stays put. Works the same from any viewing angle (it compares the label cards as seen from the front). *Settings → Keep labels apart* (1; 0 = off). On a 49-note project in timeline mode: overlapping label area 32 % → 3 %. |
| 🐞 | **No more flicker** | Fixed: overlapping labels flickered (cards nearly at the same depth — always in 2D mode — won and lost against each other frame by frame); labels are now drawn far → near instead. Labels could also blink off while turning the view, because the view read the physics worker's buffer after handing it back. And the layout never came to rest with the timeline or 2D mode on: it now stops computing once nothing moves, and wakes up on drag, settings or data changes. |
| ↩️ | **Labels on several lines** | Long labels wrap at word boundaries — about 22 characters per line, up to 3 lines (*Settings → Label line width*; 0 = one line, cut at 40 characters). |
| 🖱 | **Clickable labels** | Labels act like their node: **hover** a label to light it up (card tinted in the highlight colour, slightly larger) and see the page preview; **click** it to fly to the note; drag it to move the note. |
| 👁 | **Page preview on hover** | Hover a note node — or its label — to see Obsidian's page preview. Needs the core *Page preview* plugin. Turn it off under *Settings → Page preview on hover*, or require a modifier key under *Settings → Page preview → 3D Graph*. |
| 🕰 | **Timeline layout** | Notes are pulled **vertically by date** — oldest at the top, newest at the bottom. **Reverse it** (newest at the top) with the *Newest at the top* switch, **⌥⌘L**, or graph ⚙ → *Timeline → Newest at the top*. Links still cluster related notes, so it's a rough timeline, not a ruler. |
| 🧵 | **Storyline** | A thin line threads through the notes in date order, so you can follow the story from first note to last. |
| 🗓 | **Time grid** | In timeline view: faint frames at each **week** (labelled *v. 42*) or **month** (*okt. 2026*) — the *Time grid* switch + *Week / Month / Auto*, or graph ⚙ → *Timeline → Time grid*. The frames follow where the notes actually are; seen from above they stack like floors. |
| 🔦 | **Hover a week or month** | Point at a time-grid frame: it fills faintly, and the notes of that period (meetings included) light up a little — node and label, weaker than a hovered note. A note or label under the pointer wins over the frame. In 2D mode the frames are seen edge-on, so the band from one frame to the next counts. Switch: *Grid hover* (graph ⚙ → *Timeline → Hover time-grid frames*). |
| ⬜ | **2D mode** | Flattens the graph into a plane facing you — pan and zoom, no rotation. With the timeline it becomes a flat time chart, the time grid seen as labelled lines. The *2D mode* switch, **⌥⌘P**, or graph ⚙ → *Timeline → 2D mode*. |
| ✋ | **Pan the view** | **Space + drag**, or **two-finger drag** on a trackpad (pinch still zooms; a mouse wheel keeps zooming). In 2D mode a plain drag on empty space pans too. Right-drag pans as before. Turn off trackpad panning under graph ⚙ → *Two-finger drag pans*. |
| ⌨️ | **Shortcuts keep working in the graph** | Fixed: with keyboard camera controls on, ⌘Q, ⌘W, ⌘S, ⌘E … did nothing while the graph had focus (the Q/W/S/E/A/D movement keys swallowed them) and the camera could keep drifting afterwards. |
| 🎚 | **Switch panel** | Top right in the graph, under the reset and ⚙ buttons: the view's on/off options as flip switches (Obsidian's own toggle look) — **Presentation** (*Network / Timeline / Story*), **2D mode**, **Timeline layout**, **Newest at the top**, **Storyline**, **Time grid** + *Week / Month / Auto*, **Grid hover**, **Labels**, **Events**, **Page preview**, **Trackpad pan**. A switch always shows the live state — a hotkey or the settings flip it visibly — and its tooltip shows the hotkey. Click *Display* to fold the panel away (remembered). Replaces the presentation, reverse and 2D toolbar buttons. |
| 🔀 | **Presentation switch** | *Presentation* in the switch panel, or **⌥⌘G** (command *Next presentation*), steps through **Network → Timeline → Timeline + storyline**. |
| 🎨 | **Colour by note type** | Two new colour-group rules (*Settings → Color Groups*): **`prop: key=value`** matches a frontmatter property (`prop: typ=hub`, several values with `\|`: `prop: källa=email\|mail`, or just `prop: status` for "has the property"), **`name: <regex>`** matches the node's name — `name: .` is a catch-all for "every other note" — and **`palette: key=path/to/note.md`** takes the colours from a note: every `value: "#hex"` line in that note's frontmatter colours the notes whose property `key` has that value (`palette: källa=_views/kortfärger.md`). Change a colour in the note and the graph follows at once; lines that aren't hex colours are skipped, and the group's own colour is ignored. The first group that matches wins, so put the catch-all last. See the example below. |
| 📅 | **Meetings as events** | A todo with the meeting tag (default `#röd`) and a due date — `- [ ] möte med Anna #röd [due:: 2026-10-20 10:00]` — becomes a **node of its own**, linked to its note, labelled *20 okt möte med Anna* and placed at **its own date** on the timeline and storyline. Hover it for the note's preview, double-click to open the note. If you keep a meeting note (`typ: möte`, named with the meeting's timestamp and the same text), the note stands in for the todo and no extra node is drawn. *Settings → Meetings*: on/off, tag, colour (red). |
| 🎯 | **Open a folder, hub or note in the graph** | Right-click a folder or note in the file list → **Open in 3D graph**, or press **⌘⇧G** for the note you're in. A folder shows everything inside it; a note or hub shows its **project** with the note **highlighted** (larger, highlight colour) and the camera on it — so you see where it sits in the structure. |

### Keyboard shortcuts

| Keys | Does |
|---|---|
| **⌘⇧G** | show the active note in the 3D graph — its project, the note highlighted |
| **⌥⌘G** | next presentation: network → timeline → timeline + storyline |
| **⌥⌘L** | reverse the timeline: newest at the top ↔ oldest at the top |
| **⌥⌘P** | 2D mode on / off |
| **Space + drag** · **two-finger drag** | pan the view |

Defaults set by the fork; change them under *Settings → Hotkeys* (search "3D graph"). Hovering a switch shows its current shortcut (your own binding if you changed it), and the help line at the bottom of the graph lists the mouse and trackpad gestures.

### What "Open in 3D graph" shows

| You pick | The graph shows | Highlighted |
|---|---|---|
| a folder | everything under that folder — for a project folder (`…/<context>/<project>`) also the notes elsewhere that belong to the project (below) | — (zooms to fit) |
| a note or hub with a `projekt: "#X"` property | everything tagged `#X` — the project | that note |
| a note in a project folder (`…/<context>/<project>/…`) without `projekt` | that project folder + the notes elsewhere that belong to the project | that note |
| any other note | the note and the notes it links to / from | that note |

It replaces the graph's current filter; set a filter yourself any time to change it.

**A note belongs to project `X`** when it carries the tag `#X` **or** names it in its properties: `projekt: "#X"` or `delprojekt: "#X/sub"` (text or list) count as the tags `X` and `X/sub` — for a tag filter, a tag colour group and the tag nodes alike. So a web clipping assigned to a project only through its properties shows up in that project's graph.

### Example: Zettelkasten file names

File names like `20261014104013 RISE UND inspo_verksamhetslogik` become the label **inspo verksamhetslogik** with:

- *Strip from label (regex):* `^\d{14}\s+(?:[A-ZÅÄÖ0-9_]+\s+){0,2}` — the 14-digit timestamp and up to two ALL-CAPS words (context, project)
- *Underscores as spaces:* on

Handy together with a tag filter: when you filter on a project, its name is implied, so it doesn't need to be on every label.

### Example: colours by note type

Groups as in the author's vault (first match wins):

| Query | Colour | Catches |
|---|---|---|
| `prop: typ=hub` | graphite | project hubs |
| `prop: typ=person` | blue | person notes |
| `prop: typ=möte` | red | meeting notes |
| `palette: källa=_views/kortfärger.md` | from the note | every note by its `källa` — the same colours the vault's project hubs tint their document cards with (*email*, *digital anteckning*, *clipping* …) |
| `name: .` | white | every other note |

The palette note's frontmatter is just `källa value: "#hex"` pairs:

```yaml
---
digital anteckning: "#e2c94c"
email: "#2b79dc"
clipping: "#d6d8db"
---
```

Meeting todos (`#röd` + a date) are red through *Settings → Meetings → Meeting color*, not through a group.

### How a note's date is found (timeline + storyline)

1. a `YYYYMMDD` / `YYYYMMDDHHmmss` prefix in the file name,
2. otherwise the frontmatter property `datum` or `date`,
3. otherwise the file's creation date.

A meeting todo uses its own due date (`[due:: YYYY-MM-DD]`, optionally ` HH:MM`, or `📅 YYYY-MM-DD`).

Tags have no date and aren't pulled; attachments are pulled but not part of the storyline.

## Settings added by the fork

| Setting | Where | Default |
|---|---|---|
| Strip from label (regex) | Settings → Labels | *(empty)* |
| Underscores as spaces in labels | Settings → Labels | off |
| Page preview on hover | Settings → Interaction | on |
| Label line width (characters) | Settings → Labels | 22 |
| Label border opacity | Settings → Labels | 0.18 |
| Label tint · Label tint on hover | Settings → Labels | 0.15 · 0.45 |
| Keep labels apart | Settings → Labels, graph ⚙ → *Labels* | 1 |
| Link distance | Settings → Forces, graph ⚙ → *Forces* | 50 |
| Hover time-grid frames | graph ⚙ → *Timeline*, switch panel | on |
| Switch panel folded | the panel's *Display* header | off (open) |
| *Changed defaults:* Center force · Repel force · Label distance | Settings → Forces / Labels | 0.02 · 20 · 300 (were 0.1 · 10 · 150) |
| Timeline layout · Newest at the top · Timeline strength · Timeline length · Storyline | graph view ⚙ → *Timeline* | off · off · 0.08 · 600 · off |
| 2D mode · Two-finger drag pans · Time grid | graph view ⚙ → *Timeline* | off · on · Off |
| Meeting todos as events · Meeting tag · Meeting color | Settings → Meetings | on · `röd` · red `#d32a32` |

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

Fork changes, by file: label fix, label formatting and line wrapping (`labelLines`), mask atlas + per-label colour/tint and far → near draw order (`setNodeColors`, `setStyle`, `updateVisibilityAndOcclusion`) in `src/rendering/label-renderer.ts`; the switch panel component in `src/ui/flip-switch.ts`; physics tick / settle-stop (`onPhysicsTick`, `wakePhysics`), time-grid hover (`pickGridStop`, `setHoveredGridStop`) and the switch panel (`buildSwitchPanel`) in `src/view.ts`; page preview, timeline, storyline, time grid (`buildTimelineGrid`, `updateTimelineGrid`), 2D mode (`toggleFlat2D`), presentation switch and the focus highlight (`showScope`, `flyToNode`) in `src/view.ts`; new settings in `src/types.ts` / `src/settings.ts`; hover source, commands, hotkeys, the file-menu item and the folder/hub/note scope (`scopeFor`) in `main.ts`. Live-testing helpers for developers: `scripts/dev/`.

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
