// XDG desktop integration for the installed copy: launcher menu entry, icon, glkvm:// handler, ~/.local/bin symlink
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { log, tryRun, which } from "./util.mjs";
import { APP_ID } from "./build.mjs";

export const dataHome = () => process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
export const defaultInstallDir = () => path.join(dataHome(), APP_ID);
export const desktopFile = () => path.join(dataHome(), "applications", `${APP_ID}.desktop`);
export const binLink = () => path.join(os.homedir(), ".local", "bin", APP_ID);
export const iconFile = () => path.join(dataHome(), "icons", "hicolor", "512x512", "apps", `${APP_ID}.png`);

export function desktopEntry(installDir) {
  const exec = path.join(installDir, `${APP_ID}.sh`);
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.5",
    "Name=GLKVM (mod)",
    "GenericName=KVM client",
    "Comment=GLKVM desktop client with glikvm-mod: sessions in separate windows, clipboard paste, 1:1 resize",
    `Exec=${exec} %U`,
    `Icon=${APP_ID}`,
    "Terminal=false",
    "Categories=Network;RemoteAccess;Utility;",
    "Keywords=KVM;GL-iNet;Comet;RM1;RM10;remote;",
    "MimeType=x-scheme-handler/glkvm;",
    "StartupNotify=true",
    "StartupWMClass=gl-kvm", // Electron derives WM_CLASS from the app's package.json name
    "",
  ].join("\n");
}

export function installDesktop(installDir) {
  const icon = path.join(installDir, "resources", "app", "resources", "icon.png");
  fs.mkdirSync(path.dirname(iconFile()), { recursive: true });
  if (fs.existsSync(icon)) fs.copyFileSync(icon, iconFile());
  fs.mkdirSync(path.dirname(desktopFile()), { recursive: true });
  fs.writeFileSync(desktopFile(), desktopEntry(installDir));
  fs.chmodSync(desktopFile(), 0o755);
  log(`desktop entry: ${desktopFile()}`);
  fs.mkdirSync(path.dirname(binLink()), { recursive: true });
  try {
    fs.rmSync(binLink(), { force: true });
    fs.symlinkSync(path.join(installDir, `${APP_ID}.sh`), binLink());
    log(`command: ${binLink()}${process.env.PATH?.split(":").includes(path.dirname(binLink())) ? "" : "  (~/.local/bin is not on your PATH)"}`);
  } catch {
  }
  refreshDesktopDb();
  if (which("xdg-mime")) tryRun("xdg-mime", ["default", `${APP_ID}.desktop`, "x-scheme-handler/glkvm"]);
}

export function uninstallDesktop() {
  for (const f of [desktopFile(), binLink(), iconFile()]) {
    if (fs.existsSync(f) || isSymlink(f)) {
      fs.rmSync(f, { force: true });
      log(`removed ${f}`);
    }
  }
  refreshDesktopDb();
}

function isSymlink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function refreshDesktopDb() {
  if (which("update-desktop-database")) tryRun("update-desktop-database", [path.dirname(desktopFile())]);
  if (which("gtk-update-icon-cache")) tryRun("gtk-update-icon-cache", ["-q", "-t", path.join(dataHome(), "icons", "hicolor")]);
}
