// find a note node's screen position, move the mouse there via CDP Input, report popover
const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } });
const send = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true })).result.value;
const pt = await ev(`
  const v = app.workspace.getLeavesOfType("3d-graph-view")[0].view, cam = v.graph.camera(), THREE_V = cam.position.constructor;
  const rect = v.graphContainer.getBoundingClientRect();
  for (let i = 0; i < v.currentNodes.length; i++) {
    const n = v.currentNodes[i]; if (n.type !== 0) continue;
    const p = new THREE_V(v.currentPositions[i*4], v.currentPositions[i*4+1], v.currentPositions[i*4+2]).project(cam);
    const x = rect.left + (p.x + 1) / 2 * rect.width, y = rect.top + (1 - p.y) / 2 * rect.height;
    if (x > rect.left + 40 && x < rect.right - 40 && y > rect.top + 40 && y < rect.bottom - 40) return { x, y, id: n.id };
  }
  return null;`);
console.log("target", JSON.stringify(pt));
for (const [dx, dy] of [[-30, -30], [0, 0]]) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x + dx, y: pt.y + dy });
await new Promise((r) => setTimeout(r, 1500));
console.log(JSON.stringify(await ev(`
  const v = app.workspace.getLeavesOfType("3d-graph-view")[0].view;
  const pop = document.querySelector(".popover.hover-popover");
  return { hovered: v.hoveredNode && v.hoveredNode.id, popover: !!pop, popoverTitle: pop && (pop.querySelector(".inline-title, .markdown-preview-view h1, .view-header-title") || {}).textContent, popoverText: pop && pop.innerText.slice(0, 160) };`)));
process.exit(0);
