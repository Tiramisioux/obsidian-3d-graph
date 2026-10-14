import fs from "fs";
const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
ws.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png" } }));
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id === 1) { fs.writeFileSync(process.argv[2], Buffer.from(d.result.data, "base64")); process.exit(0); } });
