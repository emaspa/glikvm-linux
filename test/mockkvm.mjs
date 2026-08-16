// Mock GLKVM device, enough to exercise the client + mod without real hardware:
//   - GET  /api/auth/check      -> {"ok":true}          (what "Add device" probes)
//   - GET  /                    -> a "device UI" page with a live <video> (canvas stream, so the
//                                  1:1 fit sees a real videoWidth/videoHeight) and a fullscreen
//                                  button the mod clones for its 1:1 button; answers the client's
//                                  is_pc_client handshake so the session shows as connected
//   - POST /api/hid/print       -> records the "typed" text (what paste-local-clipboard sends)
//
//   openssl req -x509 -newkey rsa:2048 -nodes -keyout test/key.pem -out test/cert.pem -subj /CN=localhost -days 30
//   node test/mockkvm.mjs 8443 MockKVM-A 1280 720 &
//   node test/mockkvm.mjs 8444 MockKVM-B 1024 768 &
// then in GLKVM: Local Access -> Add Device -> 127.0.0.1:8443 (the client accepts the self-signed cert).
// Requests are logged to test/mock-<port>.log.
import https from "node:https";
import fs from "node:fs";
const [port, name = "MockKVM", vw = "1280", vh = "720"] = process.argv.slice(2);
if (!port) {
  console.error("usage: node test/mockkvm.mjs <port> [name] [videoWidth] [videoHeight]");
  process.exit(2);
}
const here = new URL("./", import.meta.url);
const opts = { key: fs.readFileSync(new URL("key.pem", here)), cert: fs.readFileSync(new URL("cert.pem", here)) };
const logf = new URL(`mock-${port}.log`, here);
const log = (s) => fs.appendFileSync(logf, `${new Date().toISOString()} ${s}\n`);
const page = `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title>
<style>
html,body{margin:0;height:100%;background:#111;color:#ddd;font:14px sans-serif}
#header{height:48px;background:#222;display:flex;align-items:center;gap:12px;padding:0 12px}
#stage{position:absolute;top:48px;bottom:32px;left:0;right:0;overflow:auto}
video{display:block}
#footer{position:absolute;bottom:0;left:0;right:0;height:32px;background:#222;padding:0 12px;line-height:32px}
.action-item{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:1px solid #555;border-radius:4px;cursor:pointer;color:#ddd}
.gl-icon{width:1em;height:1em;fill:currentColor}
</style></head><body>
<svg style="display:none"><symbol id="gl-kvm-fullscreen" viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.5"/></symbol></svg>
<div id="header"><b>${name}</b><span id="status">device UI</span>
 <div class="action-wrap"><div class="action-item" id="fs" title="Fullscreen"><span><svg class="gl-icon"><use xlink:href="#gl-kvm-fullscreen"></use></svg></span></div></div>
 <div class="action-item" title="webterm" onclick="parent.postMessage(JSON.stringify({action:'open_webterm',deviceKey:window.__dk}),'*')">T</div>
</div>
<div id="stage"><video id="v" autoplay muted playsinline></video></div>
<div id="footer">typed: <span id="typed"></span></div>
<script>
const c = document.createElement("canvas"); c.width = ${vw}; c.height = ${vh};
const g = c.getContext("2d");
let n = 0;
setInterval(() => { n++; g.fillStyle = "#123"; g.fillRect(0,0,c.width,c.height); g.fillStyle="#fff"; g.font="48px sans-serif"; g.fillText("${name} " + c.width + "x" + c.height + "  #" + n, 40, 100);
  g.strokeStyle="#0f0"; g.lineWidth=4; g.strokeRect(2,2,c.width-4,c.height-4); }, 500);
document.getElementById("v").srcObject = c.captureStream(10);
window.addEventListener("message", (e) => {
  let d; try { d = JSON.parse(e.data); } catch { return; }
  if (d.action === "is_pc_client") {
    window.__dk = d.deviceKey;
    e.source.postMessage(JSON.stringify({ action: "device_key_accepted", deviceKey: d.deviceKey }), "*");
    e.source.postMessage(JSON.stringify({ action: "mounted", deviceKey: d.deviceKey }), "*");
    document.getElementById("status").textContent = "connected to client " + JSON.stringify(d.payload);
  }
});
setInterval(() => fetch("/api/hid/typed").then(r => r.text()).then(t => document.getElementById("typed").textContent = t.slice(-60)), 1000);
</script></body></html>`;
let typed = "";
https
  .createServer(opts, (req, res) => {
    const url = new URL(req.url, "https://x");
    log(`${req.method} ${req.url} ua=...${(req.headers["user-agent"] || "").slice(-30)} cookie=${req.headers.cookie || "-"}`);
    if (url.pathname === "/api/auth/check") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ ok: true, result: { user: null } }));
    }
    if (url.pathname === "/api/hid/print") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        typed += body;
        log(`PRINT limit=${url.searchParams.get("limit")} slow=${url.searchParams.get("slow")} body=${JSON.stringify(body)}`);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, result: {} }));
      });
      return;
    }
    if (url.pathname === "/api/hid/typed") return res.end(typed);
    if (url.pathname.startsWith("/api/")) {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ ok: true, result: {} }));
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("set-cookie", "auth_token=mock; Path=/; SameSite=Strict; HttpOnly");
    res.end(page);
  })
  .listen(Number(port), "127.0.0.1", () => {
    log(`listening ${port}`);
    console.log(`mock KVM "${name}" (${vw}x${vh}) on https://127.0.0.1:${port}  log: ${logf.pathname}`);
  });
