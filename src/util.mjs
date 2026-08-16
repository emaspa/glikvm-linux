// Small shared helpers: logging, process spawning, hashing.
import fs from "node:fs";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

export const log = (...a) => console.log("•", ...a);
export const warn = (...a) => console.warn("!", ...a);
export const die = (msg) => {
  console.error("✗", msg);
  process.exit(1);
};

export function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function which(bin) {
  const r = spawnSync("which", [bin], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** run a command, throw with stderr on failure; returns stdout */
export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status}):\n${(r.stderr || r.stdout || "").trim().slice(-2000)}`);
  return r.stdout;
}

/** best-effort run: null on failure */
export function tryRun(cmd, args, opts = {}) {
  try {
    return run(cmd, args, opts);
  } catch {
    return null;
  }
}

export function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
