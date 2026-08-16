// build pipeline: stock payload -> extracted app -> patched (glikvm-mod + Linux) -> assembled Electron app dir
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { extractAll } from "@electron/asar";
import { download as downloadElectron } from "@electron/get";
import extractZip from "extract-zip";
import { log, warn, die, sha256, rmrf, readJson, writeJson, fmtBytes } from "./util.mjs";
import { resolveSource, DEFAULT_ELECTRON } from "./source.mjs";
import { ensureMod, loadMod, modCommit } from "./mod.mjs";
import { linuxPatches, modPatchVariants, LINUX_VERSION } from "./patches.mjs";

export const MARKER = "glikvm-linux.json";
export const APP_ID = "glkvm-mod"; // binary name, desktop file id, install dir name

/** node --check, honouring the module kind (renderer bundles are ESM, main/preload are CJS) */
function syntaxCheck(file, tmpDir) {
  const code = fs.readFileSync(file, "utf8");
  const esm = /^(import|export)\s/m.test(code.slice(0, 4000));
  const tmp = path.join(tmpDir, path.basename(file) + (esm ? ".mjs" : ".cjs"));
  fs.writeFileSync(tmp, code);
  const r = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
  fs.rmSync(tmp, { force: true });
  if (r.status !== 0) die(`syntax error in patched ${file}:\n${(r.stderr || "").split("\n").slice(0, 12).join("\n")}`);
}

function applyPatches(appDir, patches, { variants = [] } = {}) {
  const touched = new Set();
  for (const p of patches) {
    const file = path.join(appDir, p.file);
    const before = fs.readFileSync(file, "utf8");
    let after;
    let what = p.what;
    try {
      after = p.apply(before);
    } catch (e) {
      if (p.optional && /anchor not found/.test(String(e.message))) {
        log(`skipped (not applicable): ${p.what}`);
        continue;
      }
      const alt = variants.find((v) => v.match.test(p.what));
      if (!alt) die(`patch failed: ${p.what}\n  ${String(e.message).split("\n")[0]}`);
      try {
        after = alt.apply(before);
        what = alt.what;
      } catch (e2) {
        die(`patch failed (and its Linux variant too): ${p.what}\n  ${String(e.message).split("\n")[0]}\n  ${String(e2.message).split("\n")[0]}`);
      }
    }
    if (after === before) die(`patch produced no change: ${what}`);
    fs.writeFileSync(file, after);
    touched.add(file);
    log(`patched: ${what}`);
  }
  return touched;
}

/**
 * Extract + patch the app into `${buildDir}/app`.
 * @returns {{ appVersion: string, electronVersion: string, modVersion: string, sourceSha256: string|null }}
 */
export async function buildApp({ here, buildDir, src, modDir, electronOverride, noMod = false }) {
  const work = path.join(buildDir, "work");
  fs.mkdirSync(work, { recursive: true });
  const source = resolveSource(src, work);
  log(`stock payload: ${source.describe}`);
  const appDir = path.join(buildDir, "app");
  rmrf(appDir);
  fs.mkdirSync(appDir, { recursive: true });
  let sourceSha256 = null;
  if (source.asar) {
    log(`extracting ${source.asar}`);
    extractAll(source.asar, appDir);
    sourceSha256 = sha256(source.asar);
  } else {
    log(`copying ${source.appDir}`);
    fs.cpSync(source.appDir, appDir, { recursive: true });
  }
  if (!fs.existsSync(path.join(appDir, "resources", "icon.png")))
    warn("resources/icon.png missing (app.asar.unpacked not next to the asar?) - tray/window icon will be blank");
  const pkg = readJson(path.join(appDir, "package.json"));
  log(`stock client ${pkg.name} ${pkg.version}`);
  const electronVersion = electronOverride || source.electronVersion || DEFAULT_ELECTRON;
  log(`electron ${electronVersion}${source.electronVersion ? " (detected from package)" : electronOverride ? " (--electron)" : " (default)"}`);

  const patchedFiles = new Set();
  let modVersion = null;
  let modRev = null;
  if (!noMod) {
    const dir = ensureMod(modDir);
    const mod = await loadMod(dir);
    modVersion = mod.MOD_VERSION;
    modRev = modCommit(dir);
    log(`glikvm-mod ${modVersion}${modRev ? ` (${modRev})` : ""} from ${dir}`);
    for (const f of applyPatches(appDir, mod.allPatches(appDir), { variants: modPatchVariants(mod) })) patchedFiles.add(f);
    for (const f of applyPatches(appDir, linuxPatches(appDir, { MOD_VERSION: modVersion }))) patchedFiles.add(f);
  } else {
    // stock-only build still needs the Linux crash fix
    const stockOnly = linuxPatches(appDir, { MOD_VERSION: "" }).filter((p) => /hookWindowMessage/.test(p.what));
    for (const f of applyPatches(appDir, stockOnly)) patchedFiles.add(f);
  }
  for (const f of patchedFiles) syntaxCheck(f, work);
  log(`syntax OK for ${patchedFiles.size} patched files`);

  const marker = {
    linuxVersion: LINUX_VERSION,
    modVersion,
    modCommit: modRev,
    appVersion: pkg.version,
    electronVersion,
    sourceSha256,
    source: source.describe,
    builtAt: new Date().toISOString(),
  };
  writeJson(path.join(appDir, MARKER), marker);
  // strip mac-only leftovers that would only confuse
  for (const f of ["electron-builder.mac.yml"]) fs.rmSync(path.join(appDir, f), { force: true });
  return marker;
}

/** download (cached) + unpack the Electron runtime for linux/<arch>, return the dist dir */
export async function fetchElectron(version, arch, cacheDir) {
  const dist = path.join(cacheDir, `electron-v${version}-linux-${arch}`);
  if (fs.existsSync(path.join(dist, "electron")) && fs.existsSync(path.join(dist, "resources"))) {
    log(`electron runtime cached at ${dist}`);
    return dist;
  }
  log(`downloading electron v${version} linux-${arch} (mirror via ELECTRON_MIRROR if set)`);
  const zip = await downloadElectron(version, { platform: "linux", arch, cacheRoot: path.join(cacheDir, "zips") });
  log(`unpacking ${path.basename(zip)} (${fmtBytes(fs.statSync(zip).size)})`);
  rmrf(dist);
  fs.mkdirSync(dist, { recursive: true });
  await extractZip(zip, { dir: dist });
  if (!fs.existsSync(path.join(dist, "electron"))) die(`electron binary missing after unpacking ${zip}`);
  return dist;
}

/** electron dist + patched app -> self-contained app dir (`${buildDir}/${APP_ID}`) */
export async function assemble({ buildDir, electronVersion, arch, cacheDir }) {
  const appDir = path.join(buildDir, "app");
  if (!fs.existsSync(path.join(appDir, MARKER))) die("no patched app in build/app - run build first");
  const dist = await fetchElectron(electronVersion, arch, cacheDir);
  const out = path.join(buildDir, APP_ID);
  rmrf(out);
  log(`assembling ${out}`);
  fs.cpSync(dist, out, { recursive: true });
  fs.renameSync(path.join(out, "electron"), path.join(out, APP_ID));
  fs.rmSync(path.join(out, "resources", "default_app.asar"), { force: true });
  fs.cpSync(appDir, path.join(out, "resources", "app"), { recursive: true });
  // launcher: chrome-sandbox is not setuid when unpacked by a normal user, and the stock
  // client runs without the sandbox anyway (it appends --no-sandbox itself); ozone hint
  // lets Wayland users opt in via ELECTRON_OZONE_PLATFORM_HINT
  const launcher = path.join(out, `${APP_ID}.sh`);
  fs.writeFileSync(
    launcher,
    [
      "#!/bin/sh",
      "# GLKVM (glikvm-mod) launcher",
      'HERE="$(cd "$(dirname "$0")" && pwd)"',
      `export CHROME_DESKTOP="\${CHROME_DESKTOP:-${APP_ID}.desktop}"`,
      `exec "$HERE/${APP_ID}" --no-sandbox "$@"`,
      "",
    ].join("\n"),
  );
  fs.chmodSync(launcher, 0o755);
  writeJson(path.join(out, MARKER), { ...readJson(path.join(appDir, MARKER)), arch });
  return out;
}

export function readMarker(dir) {
  const p = path.join(dir, MARKER);
  return fs.existsSync(p) ? readJson(p) : null;
}
