// Poke the running client over Chrome DevTools Protocol (renderer has nodeIntegration, so
// window.utils.* and require("electron") are reachable). Start the app with a debug port first:
//   ~/.local/share/glkvm-mod/glkvm-mod.sh --remote-debugging-port=9333
// then:
//   node test/cdp.mjs 9333 list                                   # targets (pages, iframes)
//   node test/cdp.mjs 9333 shot home.png view/home                # screenshot the page whose title/url contains "view/home"
//   node test/cdp.mjs 9333 eval "window.utils.glFitWindow()" view/remote
//   node test/cdp.mjs 9333 eval "require('electron').clipboard.writeText('hi'); window.utils.glPasteClipboard()" view/remote
import fs from "node:fs";
const [port, cmd, ...rest] = process.argv.slice(2);
if (!port || !cmd) {
  console.error("usage: node test/cdp.mjs <port> list | shot <out.png> [match] | eval <js> [match]");
  process.exit(2);
}
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
if (cmd === "list") {
  console.log(targets.map((t) => `${t.type}\t${t.title}\t${t.url.slice(0, 120)}`).join("\n"));
  process.exit(0);
}
const match = rest[1];
const pages = targets.filter((t) => t.type === "page" && (!match || t.title.includes(match) || t.url.includes(match)));
if (!pages.length) {
  console.error("no page target matches", match);
  process.exit(1);
}
const t = pages[0];
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  }
};
await new Promise((r) => (ws.onopen = r));
if (cmd === "shot") {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(rest[0], Buffer.from(r.data, "base64"));
  console.log("saved", rest[0], "<-", t.title, t.url.slice(-60));
} else if (cmd === "eval") {
  const r = await send("Runtime.evaluate", { expression: rest[0], awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result?.value ?? r.result, null, 1));
}
ws.close();
