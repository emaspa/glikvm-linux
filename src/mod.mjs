// glikvm-mod checkout: the anchored patches + injected code that give the client
// multi-window sessions, clipboard paste, 1:1 resize, etc. We reuse them verbatim
// (Node's built-in TypeScript type stripping loads src/patches.ts directly).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { log, die, run, which } from "./util.mjs";

export const MOD_REPO = "https://github.com/emaspa/glikvm-mod.git";

export function defaultModDir(here) {
  return path.join(here, "vendor", "glikvm-mod");
}

export function ensureMod(dir, { update = false } = {}) {
  const patches = path.join(dir, "src", "patches.ts");
  if (!fs.existsSync(patches)) {
    if (!which("git")) die(`glikvm-mod not found at ${dir} and git is not available to clone it (use --mod <dir>)`);
    log(`cloning glikvm-mod -> ${dir}`);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    run("git", ["clone", "--depth", "1", MOD_REPO, dir], { stdio: ["ignore", "inherit", "inherit"] });
  } else if (update) {
    log(`updating glikvm-mod in ${dir}`);
    run("git", ["-C", dir, "pull", "--ff-only"], { stdio: ["ignore", "inherit", "inherit"] });
  }
  if (!fs.existsSync(patches)) die(`${patches} still missing after clone`);
  return dir;
}

export function modCommit(dir) {
  try {
    return run("git", ["-C", dir, "rev-parse", "--short", "HEAD"]).trim();
  } catch {
    return null;
  }
}

/** load { allPatches, MOD_VERSION, REPO_URL } from the checkout */
export async function loadMod(dir) {
  const ts = process.features?.typescript;
  if (!ts) {
    die(
      `this Node (${process.version}) cannot load TypeScript directly; use Node >= 23.6 (or run with --experimental-strip-types on 22.6+)`,
    );
  }
  const mod = await import(pathToFileURL(path.join(dir, "src", "patches.ts")).href);
  if (typeof mod.allPatches !== "function") die("glikvm-mod/src/patches.ts does not export allPatches()");
  return mod;
}
