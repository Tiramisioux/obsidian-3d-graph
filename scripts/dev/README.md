# Live testing against a running Obsidian (fork development)

Obsidian must run with remote debugging (local only):

```bash
osascript -e 'quit app "Obsidian"'
open -a Obsidian --args --remote-debugging-port=9222 --remote-allow-origins=http://127.0.0.1
```

| Script | Does |
|---|---|
| `node cdp.mjs '<js>'` | evaluates JS in Obsidian's window (async body, `return` a value) — e.g. reload the plugin: `await app.plugins.disablePlugin("new-3d-graph-tiramisioux"); await app.plugins.enablePlugin("new-3d-graph-tiramisioux")` |
| `node shot.mjs out.png` | screenshot of the Obsidian window |
| `node hover.mjs` | moves the real mouse onto a visible note node and reports whether Obsidian's page preview opened |

The 3D view is `app.workspace.getLeavesOfType("3d-graph-view")[0].view` — `labelRenderer`, `currentPositions`, `currentNodes`, `timelineTargets`, `storylineOrder` are readable from there. Quit and reopen Obsidian normally to close the debug port.

## Thumbnail benchmark (no Obsidian needed)

`thumbs-bench.ts` runs the thumbnail renderer (`src/rendering/thumbnail-renderer.ts`) on a plain three.js scene with 4 325 cards and prints decode / cache / upload / frame-time numbers. Put some scans in `scans/0.jpg …` next to a copy of the built page and serve it:

```bash
npx esbuild scripts/dev/thumbs-bench.ts --bundle --outfile=/tmp/bench/harness.js --format=iife --target=es2020
echo '<!doctype html><meta charset=utf-8><body><script src="harness.js"></script>' > /tmp/bench/harness.html
cd /tmp/bench && python3 -m http.server 8765    # then open http://localhost:8765/harness.html?nocache=1 and call report() in the console
```

The page must be in a visible tab (requestAnimationFrame is throttled in a hidden one). `?n=` card count, `?pages=` atlas pages, `?view=near|far`, `?nocache` skips IndexedDB.
