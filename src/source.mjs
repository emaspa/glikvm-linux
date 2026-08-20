// Locate the stock GLKVM app payload (app.asar) inside whatever the user has:
//   - the macOS .dmg            (needs 7z; extracts only Resources/ + the Electron plist)
//   - the Windows NSIS .exe     (needs 7z; installer -> $PLUGINSDIR/app-64.7z -> resources/)
//   - a directory               (Windows install dir, mounted .app, or an already-extracted app dir)
//   - an app.asar file directly
// and figure out which Electron version the stock client was built with.
import fs from "node:fs";
import path from "node:path";
import { log, warn, die, run, which, rmrf } from "./util.mjs";

export const DEFAULT_ELECTRON = "34.5.8"; // GLKVM 1.5.0

function need7z() {
  const bin = which("7z") || which("7zz") || which("7za");
  if (!bin) die("7z is required to open .dmg / .exe packages (install p7zip-full / 7zip), or pass --src pointing at an app.asar / extracted directory");
  return bin;
}

function plistString(xml, key) {
  const m = xml.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  return m ? m[1] : null;
}

/** scan a (possibly large) binary for an "Electron/x.y.z" marker */
function scanElectronVersion(file) {
  try {
    const fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const chunk = Buffer.alloc(8 * 1024 * 1024);
    let carry = "";
    for (let off = 0; off < size; off += chunk.length) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, off);
      const text = carry + chunk.subarray(0, n).toString("latin1");
      const m = text.match(/Electron\/(\d+\.\d+\.\d+)/);
      if (m) {
        fs.closeSync(fd);
        return m[1];
      }
      carry = text.slice(-32);
    }
    fs.closeSync(fd);
  } catch {
  }
  return null;
}

function findFirst(dir, names) {
  for (const n of names) {
    const p = path.join(dir, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * @returns {{ asar: string|null, appDir: string|null, electronVersion: string|null, describe: string }}
 *   exactly one of `asar` (path to app.asar, .unpacked sibling honoured) or `appDir` (extracted app) is set
 */
export function resolveSource(src, workDir) {
  if (!src) {
    // default: first .dmg / .exe next to us
    const here = process.cwd();
    const cand = fs.readdirSync(here).filter((f) => /\.(dmg|exe)$/i.test(f)).sort().reverse(); // newest version first
    if (!cand.length) die("no --src given and no .dmg/.exe found in the current directory");
    src = path.join(here, cand[0]);
    log(`using ${src}`);
  }
  src = path.resolve(src);
  if (!fs.existsSync(src)) die(`source not found: ${src}`);
  const st = fs.statSync(src);

  if (st.isDirectory()) {
    if (fs.existsSync(path.join(src, "package.json")) && fs.existsSync(path.join(src, "out", "main", "index.js"))) {
      return { asar: null, appDir: src, electronVersion: null, describe: `extracted app dir ${src}` };
    }
    const asar = findFirst(src, ["resources/app.asar", "app.asar", "Contents/Resources/app.asar", "Resources/app.asar"]);
    if (!asar) die(`no app.asar found under ${src}`);
    let electronVersion = null;
    const plist = findFirst(src, [
      "Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist",
      "Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist",
    ]);
    if (plist) electronVersion = plistString(fs.readFileSync(plist, "utf8"), "CFBundleVersion");
    if (!electronVersion) {
      const exe = findFirst(src, ["GLKVM.exe", "electron.exe", "glkvm", "electron"]);
      if (exe) electronVersion = scanElectronVersion(exe);
    }
    return { asar, appDir: null, electronVersion, describe: `directory ${src}` };
  }

  const ext = path.extname(src).toLowerCase();
  if (ext === ".asar") {
    return { asar: src, appDir: null, electronVersion: null, describe: `asar ${src}` };
  }

  if (ext === ".dmg") {
    const bin = need7z();
    const out = path.join(workDir, "dmg");
    rmrf(out);
    fs.mkdirSync(out, { recursive: true });
    log(`extracting app payload from ${path.basename(src)} (7z)`);
    // pull only what we need: the app payload and the Electron framework plist (version)
    run(bin, [
      "x", "-y", `-o${out}`, src,
      "-ir!*.app/Contents/Resources/*",
      "-ir!*.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist",
      "-xr!*:com.apple.*", // xattr side streams
    ]);
    const apps = fs.readdirSync(out).filter((f) => f.endsWith(".app"));
    if (!apps.length) die(`no .app bundle found inside ${src}`);
    const app = path.join(out, apps[0]);
    const asar = path.join(app, "Contents", "Resources", "app.asar");
    if (!fs.existsSync(asar)) die(`app.asar not found inside ${apps[0]}`);
    const plist = path.join(app, "Contents", "Frameworks", "Electron Framework.framework", "Versions", "A", "Resources", "Info.plist");
    const electronVersion = fs.existsSync(plist) ? plistString(fs.readFileSync(plist, "utf8"), "CFBundleVersion") : null;
    return { asar, appDir: null, electronVersion, describe: `${path.basename(src)} (${apps[0]})` };
  }

  if (ext === ".exe") {
    const bin = need7z();
    const out = path.join(workDir, "exe");
    rmrf(out);
    fs.mkdirSync(out, { recursive: true });
    log(`extracting app payload from ${path.basename(src)} (7z, NSIS installer)`);
    // electron-builder NSIS: the app lives in $PLUGINSDIR/app-64.7z (or app-32 / app-arm64)
    run(bin, ["x", "-y", `-o${out}`, src, "-ir!$PLUGINSDIR/app-*.7z"]);
    const inner = fs.existsSync(path.join(out, "$PLUGINSDIR")) ? fs.readdirSync(path.join(out, "$PLUGINSDIR")).filter((f) => /^app-.*\.7z$/.test(f)) : [];
    if (!inner.length) {
      // maybe a plain (non-NSIS) layout: resources/app.asar directly inside
      const direct = path.join(out, "resources", "app.asar");
      if (fs.existsSync(direct)) return { asar: direct, appDir: null, electronVersion: scanElectronVersion(src), describe: path.basename(src) };
      die(`could not find app-*.7z inside ${src}`);
    }
    const inner7z = path.join(out, "$PLUGINSDIR", inner[0]);
    const app = path.join(out, "app");
    fs.mkdirSync(app, { recursive: true });
    run(bin, ["x", "-y", `-o${app}`, inner7z, "resources/app.asar", "resources/app.asar.unpacked", "GLKVM.exe"]);
    const asar = path.join(app, "resources", "app.asar");
    if (!fs.existsSync(asar)) die(`resources/app.asar not found inside ${inner[0]}`);
    const exe = path.join(app, "GLKVM.exe");
    const electronVersion = fs.existsSync(exe) ? scanElectronVersion(exe) : null;
    return { asar, appDir: null, electronVersion, describe: `${path.basename(src)} (${inner[0]})` };
  }

  warn(`unrecognised source type ${ext}; trying to treat it as an asar`);
  return { asar: src, appDir: null, electronVersion: null, describe: src };
}
