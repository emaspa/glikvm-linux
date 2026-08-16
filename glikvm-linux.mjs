#!/usr/bin/env node
// glikvm-linux - build a Linux version of the GLKVM desktop client (GL-iNet Comet / RM1 / RM10)
// based on the macOS and Windows packages, with glikvm-mod applied
// (sessions in separate windows, tab drag/tear-out, paste local clipboard, 1:1 resize, ...).
//
//   node glikvm-linux.mjs build      [--src <pkg>]   extract + patch + assemble ./build/glkvm-mod (portable app dir)
//   node glikvm-linux.mjs install    [--src <pkg>]   build + install to ~/.local/share/glkvm-mod + menu entry "GLKVM (mod)"
//   node glikvm-linux.mjs run        [-- args]       launch the installed (or built) app
//   node glikvm-linux.mjs status                     what is built / installed
//   node glikvm-linux.mjs package                    build + tar.gz (and AppImage if possible) into ./dist
//   node glikvm-linux.mjs uninstall                  remove the installed copy + menu entry
//   node glikvm-linux.mjs update-mod                 git pull the vendored glikvm-mod
//
// Options:
//   --src <path>     GLKVM package: .dmg (macOS), .exe (Windows installer), install dir, or app.asar
//                    (default: first .dmg/.exe in the current directory)
//   --dest <dir>     install dir (default: $XDG_DATA_HOME/glkvm-mod = ~/.local/share/glkvm-mod)
//   --mod <dir>      glikvm-mod checkout (default: ./vendor/glikvm-mod, cloned on first use)
//   --electron <v>   Electron version to bundle (default: detected from the package, else 34.5.8)
//   --arch <a>       x64 | arm64 (default: this machine)
//   --no-mod         build the stock client only (still with the Linux crash fix)
//   --cache <dir>    download cache (default: ~/.cache/glikvm-linux)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { log, warn, die, run, which, rmrf, readJson, writeJson, fmtBytes } from "./src/util.mjs";
import { buildApp, assemble, readMarker, APP_ID, MARKER } from "./src/build.mjs";
import { ensureMod, defaultModDir } from "./src/mod.mjs";
import { defaultInstallDir, installDesktop, uninstallDesktop, desktopFile, desktopEntry } from "./src/desktop.mjs";
import { LINUX_VERSION } from "./src/patches.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const dashdash = argv.indexOf("--");
const own = dashdash === -1 ? argv : argv.slice(0, dashdash);
const passthrough = dashdash === -1 ? [] : argv.slice(dashdash + 1);
const cmd = own.find((a) => !a.startsWith("--")) ?? "help";
const flag = (name) => own.includes(`--${name}`);
const opt = (name, def) => {
  const i = own.indexOf(`--${name}`);
  return i !== -1 && own[i + 1] && !own[i + 1].startsWith("--") ? own[i + 1] : def;
};

const BUILD = path.join(HERE, "build");
const DIST = path.join(HERE, "dist");
const CACHE = opt("cache", path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "glikvm-linux"));
const DEST = path.resolve(opt("dest", defaultInstallDir()));
const MOD_DIR = path.resolve(opt("mod", defaultModDir(HERE)));
const ARCH = opt("arch", process.arch === "arm64" ? "arm64" : "x64");
const SRC = opt("src", null);

if (process.platform !== "linux") warn(`this tool assembles a Linux app; running it on ${process.platform} only makes sense for cross-building`);

async function build() {
  const marker = await buildApp({ here: HERE, buildDir: BUILD, src: SRC, modDir: MOD_DIR, electronOverride: opt("electron", null), noMod: flag("no-mod") });
  const out = await assemble({ buildDir: BUILD, electronVersion: marker.electronVersion, arch: ARCH, cacheDir: CACHE });
  log(`built GLKVM ${marker.appVersion}${marker.modVersion ? ` + ui-mod ${marker.modVersion}` : " (stock)"} on electron ${marker.electronVersion} linux-${ARCH}`);
  log(`portable app dir: ${out}   (run: ${path.join(out, APP_ID + ".sh")})`);
  return { marker, out };
}

async function install() {
  const { marker, out } = await build();
  if (fs.existsSync(DEST)) {
    if (!readMarker(DEST)) die(`${DEST} exists but is not a glikvm-linux install (no ${MARKER}); refusing to overwrite - pick another --dest`);
    // keep it simple and robust: replace wholesale (the app has no state in its install dir)
    rmrf(DEST);
  }
  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  log(`installing -> ${DEST}`);
  fs.cpSync(out, DEST, { recursive: true });
  installDesktop(DEST);
  log(`installed GLKVM ${marker.appVersion} + ui-mod ${marker.modVersion} + linux ${LINUX_VERSION}`);
  log(`run it: node glikvm-linux.mjs run   (or "GLKVM (mod)" in your app menu, or ${path.join(DEST, APP_ID + ".sh")})`);
  log(`settings/login live in ~/.config/gl-kvm (same as the official client would use)`);
}

function uninstall() {
  if (fs.existsSync(DEST)) {
    if (!readMarker(DEST)) die(`${DEST} does not look like a glikvm-linux install (no ${MARKER}); not touching it`);
    rmrf(DEST);
    log(`removed ${DEST}`);
  } else log(`nothing at ${DEST}`);
  uninstallDesktop();
  log(`(your login/settings in ~/.config/gl-kvm were left alone)`);
}

function runApp() {
  const candidates = [path.join(DEST, `${APP_ID}.sh`), path.join(BUILD, APP_ID, `${APP_ID}.sh`)];
  const exe = candidates.find((p) => fs.existsSync(p));
  if (!exe) die(`nothing to run - do 'node glikvm-linux.mjs install' (or build) first`);
  const child = spawn(exe, passthrough, { cwd: path.dirname(exe), stdio: "ignore", detached: true });
  child.unref();
  log(`launched ${exe} ${passthrough.join(" ")}`.trim());
}

function status() {
  log(`glikvm-linux ${LINUX_VERSION}   node ${process.version}   7z: ${which("7z") || which("7zz") || which("7za") || "MISSING"}`);
  const modOk = fs.existsSync(path.join(MOD_DIR, "src", "patches.ts"));
  log(`glikvm-mod: ${MOD_DIR} ${modOk ? "(present)" : "(not cloned yet)"}`);
  for (const [label, dir] of [
    ["build", path.join(BUILD, APP_ID)],
    ["installed", DEST],
  ]) {
    const m = readMarker(dir);
    if (!m) {
      log(`${label}: none (${dir})`);
      continue;
    }
    log(`${label}: GLKVM ${m.appVersion} + ui-mod ${m.modVersion ?? "-"}${m.modCommit ? `@${m.modCommit}` : ""} + linux ${m.linuxVersion}, electron ${m.electronVersion} ${m.arch || ""}, built ${m.builtAt} from ${m.source}`);
  }
  log(`desktop entry: ${fs.existsSync(desktopFile()) ? desktopFile() : "not installed"}`);
}

async function pkg() {
  const { marker, out } = await build();
  fs.mkdirSync(DIST, { recursive: true });
  const base = `GLKVM-mod-${marker.appVersion}-uimod${marker.modVersion}-linux-${ARCH}`;
  // 1) tarball of the portable dir
  const tar = path.join(DIST, `${base}.tar.gz`);
  fs.rmSync(tar, { force: true });
  log(`packing ${tar}`);
  run("tar", ["-C", path.dirname(out), "-czf", tar, path.basename(out)]);
  log(`tarball: ${tar} (${fmtBytes(fs.statSync(tar).size)})`);
  // 2) AppImage (optional): needs appimagetool; we fetch it into the cache if missing
  if (flag("no-appimage")) return;
  const tool = await getAppImageTool();
  if (!tool) {
    warn("appimagetool unavailable (offline / no curl?) - skipped AppImage; the tarball is complete on its own");
    return;
  }
  const appDir = path.join(BUILD, `${APP_ID}.AppDir`);
  rmrf(appDir);
  fs.mkdirSync(appDir, { recursive: true });
  fs.cpSync(out, path.join(appDir, "usr", "lib", APP_ID), { recursive: true });
  const icon = path.join(out, "resources", "app", "resources", "icon.png");
  if (fs.existsSync(icon)) {
    fs.copyFileSync(icon, path.join(appDir, `${APP_ID}.png`));
    fs.copyFileSync(icon, path.join(appDir, ".DirIcon"));
  }
  fs.writeFileSync(path.join(appDir, `${APP_ID}.desktop`), desktopEntry("/usr/lib/" + APP_ID).replace(/^Exec=.*$/m, `Exec=${APP_ID} %U`));
  fs.writeFileSync(
    path.join(appDir, "AppRun"),
    ["#!/bin/sh", 'HERE="$(dirname "$(readlink -f "$0")")"', `exec "$HERE/usr/lib/${APP_ID}/${APP_ID}.sh" "$@"`, ""].join("\n"),
  );
  fs.chmodSync(path.join(appDir, "AppRun"), 0o755);
  const appimage = path.join(DIST, `${base}.AppImage`);
  fs.rmSync(appimage, { force: true });
  log(`building ${appimage}`);
  try {
    run(tool, ["--appimage-extract-and-run", appDir, appimage], { env: { ...process.env, ARCH: ARCH === "arm64" ? "aarch64" : "x86_64", NO_STRIP: "1" } });
    log(`AppImage: ${appimage} (${fmtBytes(fs.statSync(appimage).size)})`);
  } catch (e) {
    warn(`AppImage build failed: ${e.message.split("\n").slice(-3).join(" ")}`);
  }
}

async function getAppImageTool() {
  const name = `appimagetool-${ARCH === "arm64" ? "aarch64" : "x86_64"}.AppImage`;
  const local = which("appimagetool");
  if (local) return local;
  const cached = path.join(CACHE, name);
  if (fs.existsSync(cached)) return cached;
  fs.mkdirSync(CACHE, { recursive: true });
  const url = `https://github.com/AppImage/appimagetool/releases/download/continuous/${name}`;
  log(`fetching ${url}`);
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(cached, Buffer.from(await res.arrayBuffer()));
    fs.chmodSync(cached, 0o755);
    return cached;
  } catch (e) {
    warn(`could not fetch appimagetool: ${e.message}`);
    return null;
  }
}

function help() {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
  console.log(src.slice(1, 22).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
}

try {
  switch (cmd) {
    case "build":
      await build();
      break;
    case "install":
      await install();
      break;
    case "uninstall":
      uninstall();
      break;
    case "run":
      runApp();
      break;
    case "status":
      status();
      break;
    case "package":
      await pkg();
      break;
    case "update-mod":
      ensureMod(MOD_DIR, { update: true });
      break;
    default:
      help();
  }
} catch (e) {
  die(e?.stack || String(e));
}
