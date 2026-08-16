// ---------------------------------------------------------------------------
// glikvm-linux: in-app updater. Checks GitHub Releases of __GL_LINUX_REPO__ for a
// newer port release (tag v<version>[-stage]), downloads the matching asset for
// this install kind (AppImage, or the tar.gz for a directory install), verifies
// it against the release's SHA256SUMS, swaps it in place and relaunches.
// Runs only on Linux; everything is best-effort and logged under [glikvm-linux].
// ---------------------------------------------------------------------------
const GL_LINUX_TAG = "__GL_LINUX_TAG__";
const GL_LINUX_REPO = "__GL_LINUX_REPO__";
const GL_LINUX_UPDATE_API = `https://api.github.com/repos/${GL_LINUX_REPO}/releases?per_page=10`;
const GL_LINUX_CHECK_INTERVAL = 6 * 60 * 60 * 1e3;
let glLinuxUpdateBusy = false;
let glLinuxUpdateTimer = null;
function glLinuxLog(...a) {
  logInfo("[glikvm-linux]", ...a);
}
function glLinuxWarn(...a) {
  logWarn("[glikvm-linux]", ...a);
}
function glLinuxParseTag(tag) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-.\s]?([a-z]+)\.?(\d*))?/i.exec(String(tag || "").trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], stage: (m[4] || "").toLowerCase(), stageNum: m[5] ? +m[5] : 0 };
}
// -1 / 0 / 1 like a comparator; a release without a stage is newer than the same number with one (0.1.0 > 0.1.0-beta)
function glLinuxCompareTags(a, b) {
  const x = glLinuxParseTag(a);
  const y = glLinuxParseTag(b);
  if (!x || !y) return 0;
  for (const k of ["major", "minor", "patch"]) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (!!x.stage !== !!y.stage) return x.stage ? -1 : 1;
  if (x.stage !== y.stage) return x.stage < y.stage ? -1 : 1;
  if (x.stageNum !== y.stageNum) return x.stageNum < y.stageNum ? -1 : 1;
  return 0;
}
function glLinuxArch() {
  return process.arch === "arm64" ? "arm64" : "x64";
}
// how this copy is installed: a mounted AppImage ($APPIMAGE), or a plain directory (tarball / glikvm-linux install)
function glLinuxInstallKind() {
  if (process.platform !== "linux") return null;
  if (process.env.APPIMAGE && fs.existsSync(process.env.APPIMAGE)) return { kind: "appimage", target: process.env.APPIMAGE };
  const root = require$$2.dirname(process.resourcesPath);
  if (fs.existsSync(require$$2.join(root, "glkvm-mod.sh")) && fs.existsSync(require$$2.join(root, "glkvm-mod"))) return { kind: "dir", target: root };
  return null;
}
async function glLinuxFetchJson(url) {
  const res = await require$$0$2.net.fetch(url, { headers: { accept: "application/vnd.github+json", "user-agent": `glikvm-linux/${GL_LINUX_TAG}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}
async function glLinuxFetchText(url) {
  const res = await require$$0$2.net.fetch(url, { headers: { "user-agent": `glikvm-linux/${GL_LINUX_TAG}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}
async function glLinuxLatestRelease() {
  const list = await glLinuxFetchJson(GL_LINUX_UPDATE_API);
  const rel = (Array.isArray(list) ? list : []).filter((r) => r && !r.draft && glLinuxParseTag(r.tag_name)).sort((a, b) => glLinuxCompareTags(b.tag_name, a.tag_name))[0];
  if (!rel) return null;
  return {
    tag: rel.tag_name,
    name: rel.name || rel.tag_name,
    notes: rel.body || "",
    page: rel.html_url,
    assets: (rel.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size }))
  };
}
function glLinuxPickAsset(rel, kind) {
  const arch = glLinuxArch();
  const re = kind === "appimage" ? new RegExp(`linux-${arch}\\.AppImage$`) : new RegExp(`linux-${arch}\\.tar\\.gz$`);
  return rel.assets.find((a) => re.test(a.name)) || null;
}
async function glLinuxDownload(url, dest, onProgress) {
  const res = await require$$0$2.net.fetch(url, { headers: { "user-agent": `glikvm-linux/${GL_LINUX_TAG}` } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} downloading ${url}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const hash = require("crypto").createHash("sha256");
  const out = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  let done = 0;
  let lastPct = -1;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    hash.update(value);
    if (!out.write(Buffer.from(value))) await new Promise((r) => out.once("drain", r));
    done += value.length;
    if (total && onProgress) {
      const pct = Math.floor((done / total) * 100);
      if (pct !== lastPct && pct % 10 === 0) {
        lastPct = pct;
        onProgress(pct, done, total);
      }
    }
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  return hash.digest("hex");
}
async function glLinuxExpectedSha(rel, assetName) {
  const sums = rel.assets.find((a) => /^SHA256SUMS(\.txt)?$/i.test(a.name));
  if (!sums) return null;
  const text = await glLinuxFetchText(sums.url);
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m && require$$2.basename(m[2]) === assetName) return m[1].toLowerCase();
  }
  return null;
}
function glLinuxNotify(body, title = "GLKVM (mod)") {
  glLinuxLog("notify:", body);
  try {
    new require$$0$2.Notification({ title, body, silent: true }).show();
  } catch (e) {
    glLinuxWarn("notification failed", String(e));
  }
}
function glLinuxRelaunch(kind, target) {
  // start the new copy after this process has released the single-instance lock
  const launcher = kind === "appimage" ? target : require$$2.join(target, "glkvm-mod.sh");
  const args = process.argv.slice(1).filter((a) => a !== "--no-sandbox");
  const child = require$$0$3.spawn("/bin/sh", ["-c", 'sleep 1.5; exec "$0" "$@"', launcher, ...args], { detached: true, stdio: "ignore" });
  child.unref();
  require$$0$2.app.exit(0);
}
// replace the running AppImage file (the mounted image keeps working until we exit)
function glLinuxSwapAppImage(target, downloaded) {
  fs.chmodSync(downloaded, 0o755);
  const backup = `${target}.old`;
  try {
    fs.rmSync(backup, { force: true });
  } catch {
  }
  fs.renameSync(target, backup);
  try {
    fs.renameSync(downloaded, target);
  } catch (e) {
    fs.renameSync(backup, target);
    throw e;
  }
  return backup;
}
// unpack the tarball next to the install dir and swap directories
function glLinuxSwapDir(root, tarball) {
  const stage = `${root}.update`;
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  require$$0$3.execFileSync("tar", ["-xzf", tarball, "-C", stage], { stdio: "ignore" });
  const entries = fs.readdirSync(stage);
  const inner = entries.length === 1 && fs.statSync(require$$2.join(stage, entries[0])).isDirectory() ? require$$2.join(stage, entries[0]) : stage;
  if (!fs.existsSync(require$$2.join(inner, "glkvm-mod.sh"))) throw new Error("tarball does not contain glkvm-mod.sh");
  const backup = `${root}.old`;
  fs.rmSync(backup, { recursive: true, force: true });
  fs.renameSync(root, backup);
  try {
    fs.renameSync(inner, root);
  } catch (e) {
    fs.renameSync(backup, root);
    throw e;
  }
  fs.rmSync(stage, { recursive: true, force: true });
  return backup;
}
function glLinuxCleanupOld() {
  try {
    const inst = glLinuxInstallKind();
    if (!inst) return;
    const old = `${inst.target}.old`;
    if (fs.existsSync(old)) {
      fs.rmSync(old, { recursive: true, force: true });
      glLinuxLog("removed previous version", old);
    }
  } catch (e) {
    glLinuxWarn("cleanup failed", String(e));
  }
}
async function glLinuxApplyUpdate(rel, inst) {
  const asset = glLinuxPickAsset(rel, inst.kind);
  if (!asset) throw new Error(`release ${rel.tag} has no ${inst.kind === "appimage" ? "AppImage" : "tar.gz"} for linux-${glLinuxArch()}`);
  const tmpDir = require$$2.join(require$$0$2.app.getPath("temp"), "glikvm-linux-update");
  fs.mkdirSync(tmpDir, { recursive: true });
  const file = require$$2.join(tmpDir, asset.name);
  glLinuxLog("downloading", asset.url, `${asset.size} bytes`);
  glLinuxNotify(`Downloading GLKVM ${rel.tag} (${Math.round(asset.size / 1048576)} MB)...`);
  const sha = await glLinuxDownload(asset.url, file, (pct) => glLinuxLog(`download ${pct}%`));
  const expected = await glLinuxExpectedSha(rel, asset.name);
  if (expected && expected !== sha) {
    fs.rmSync(file, { force: true });
    throw new Error(`checksum mismatch for ${asset.name}`);
  }
  if (!expected) glLinuxWarn("release has no SHA256SUMS entry for", asset.name, "- installing unverified");
  glLinuxLog("verified", asset.name, sha.slice(0, 12));
  const backup = inst.kind === "appimage" ? glLinuxSwapAppImage(inst.target, file) : glLinuxSwapDir(inst.target, file);
  glLinuxLog("installed", rel.tag, "previous kept at", backup);
  const choice = require$$0$2.dialog.showMessageBoxSync({
    type: "info",
    title: "GLKVM (mod) updated",
    message: `GLKVM ${rel.tag} is installed`,
    detail: "Restart now to start using it? Open sessions will be closed.",
    buttons: ["Restart now", "Later"],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (choice === 0) glLinuxRelaunch(inst.kind, inst.target);
}
// manual = triggered from About; then "up to date" and errors are shown too
async function glLinuxCheckForUpdates(manual) {
  if (glLinuxUpdateBusy) {
    if (manual) glLinuxNotify("An update check or download is already running.");
    return;
  }
  const inst = glLinuxInstallKind();
  glLinuxUpdateBusy = true;
  try {
    const rel = await glLinuxLatestRelease();
    if (!rel) {
      if (manual) glLinuxNotify("No releases found.");
      return;
    }
    const newer = glLinuxCompareTags(rel.tag, GL_LINUX_TAG) > 0;
    glLinuxLog("update check", { installed: GL_LINUX_TAG, latest: rel.tag, newer, kind: inst?.kind || "unknown" });
    if (!newer) {
      if (manual) glLinuxNotify(`You have the latest version (${GL_LINUX_TAG}).`);
      return;
    }
    if (!manual && store.get("linuxUpdateSkip") === rel.tag) return;
    if (!inst) {
      // e.g. running from a build dir: just point at the release page
      const c = require$$0$2.dialog.showMessageBoxSync({
        type: "info",
        title: "GLKVM (mod) update available",
        message: `GLKVM ${rel.tag} is available (you have ${GL_LINUX_TAG})`,
        detail: "This copy cannot update itself. Download it from the releases page?",
        buttons: ["Open releases page", "Later"],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });
      if (c === 0) require$$0$2.shell.openExternal(rel.page);
      return;
    }
    const notes = String(rel.notes || "").replace(/\r/g, "").trim().slice(0, 1200);
    const choice = require$$0$2.dialog.showMessageBoxSync({
      type: "question",
      title: "GLKVM (mod) update available",
      message: `${rel.name} is available (you have ${GL_LINUX_TAG})`,
      detail: `${notes ? notes + "\n\n" : ""}Download and install it now? ${inst.kind === "appimage" ? "The AppImage file is replaced in place" : "The install directory is replaced"}; the previous version is kept next to it until the next start.`,
      buttons: ["Update", "Later", "Skip this version"],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (choice === 2) {
      store.set("linuxUpdateSkip", rel.tag);
      return;
    }
    if (choice !== 0) return;
    await glLinuxApplyUpdate(rel, inst);
  } catch (e) {
    glLinuxWarn("update failed", String(e && e.stack || e));
    if (manual) glLinuxNotify(`Update check failed: ${e?.message || e}`);
  } finally {
    glLinuxUpdateBusy = false;
  }
}
function glLinuxUpdaterInit() {
  if (process.platform !== "linux") return;
  glLinuxCleanupOld();
  if (process.env.GLKVM_LINUX_NO_UPDATE_CHECK) return;
  setTimeout(() => glLinuxCheckForUpdates(false), 8e3);
  glLinuxUpdateTimer = setInterval(() => glLinuxCheckForUpdates(false), GL_LINUX_CHECK_INTERVAL);
}
