// node cdp.mjs '<js expression>'  — evaluates in Obsidian's page via CDP (port 9222)
const expr = process.argv[2];
const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true } }));
ws.addEventListener("message", (m) => {
  const d = JSON.parse(m.data);
  if (d.id !== 1) return;
  const r = d.result;
  console.log(r.exceptionDetails ? "EXC: " + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails) : JSON.stringify(r.result.value, null, 1));
  ws.close(); process.exit(0);
});
