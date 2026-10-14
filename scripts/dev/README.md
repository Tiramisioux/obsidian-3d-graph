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
