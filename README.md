# glikvm-linux

Build a **Linux version of the GLKVM desktop client** (GL-iNet Comet / RM1 / RM10) based on the macOS and Windows packages, with [glikvm-mod](https://github.com/emaspa/glikvm-mod) applied. GL-iNet only ships the client for Windows and macOS; this tool takes the official `.dmg` (or `.exe`), applies the mod, and produces a Linux app with everything the mod adds on Windows:

| Feature | |
|---|---|
| **Sessions in separate windows** | `Shift`+click a device, or set *Open sessions in: A separate window per session* |
| **Tab management like a browser** | reorder tabs by dragging · tear a tab out into its own window · drop a tab on another window's tab strip · combine windows by dragging one onto another's strip · right-click a tab → *Move to its own window* / *Move into the main session window* |
| **"+" new-session button** | at the end of the tab strip: recent sessions, local-access devices, *Choose from device list...* |
| **Paste local clipboard into the remote machine** | `Ctrl+Alt+V` (configurable), or right-click a tab; optional *Slow* paste |
| **1:1 resize to KVM resolution** | button next to fullscreen in the session toolbar, tab menu, or *Always open sessions at 1:1* |
| **Start screen** | open on Remote Access or Local Access; Back from Settings returns to the last access page |
| Window titles = device name, geometry inheritance, settings UI under *Settings → General → Sessions (ui-mod)*, mod/port stamps in About | |

The client shows up as `V1.5.0 r1-linux · ui-mod 0.1.5` in the footer, `GLKVM V1.5.0 r1-linux` and *ui-mod 0.1.5 · linux 0.1.0 installed* in About.

## Requirements

* Linux x64 (arm64 with `--arch arm64`, untested), glibc-based distro able to run Electron 34 (Ubuntu 22.04+ / Fedora / Arch / ...).
* [Node.js](https://nodejs.org) **24** (≥ 23.6; it loads glikvm-mod's TypeScript patch definitions with Node's built-in type stripping - no bun, no tsc), `git`, and `7z` (`p7zip-full` / `7zip` package) to open the `.dmg`/`.exe`.
* **The official GLKVM package** for macOS (`gl-kvm-<version>.dmg`) or Windows (`GLKVM-Setup-<version>.exe`) from the [GL-iNet app page](https://www.gl-inet.com/en-de/pages/app-rm), placed in this directory (or given with `--src`). Tested with **1.5.0 release1** (Electron 34.5.8). Nothing from GL-iNet is redistributed here; the tool reads the package you downloaded.
* No root: everything goes to `~/.local/share/glkvm-mod` and your app menu.

## Install

```sh
git clone https://github.com/emaspa/glikvm-linux.git
cd glikvm-linux
npm install
# put gl-kvm-1.5.0-release1.dmg (or the Windows .exe) in this directory, then:
node glikvm-linux.mjs install        # extract + patch + fetch Electron + install + "GLKVM (mod)" menu entry
node glikvm-linux.mjs run            # or launch "GLKVM (mod)" from your app menu, or ~/.local/bin/glkvm-mod
node glikvm-linux.mjs status
node glikvm-linux.mjs uninstall
```

Other commands: `build` (only produce the portable dir `build/glkvm-mod`), `package` (build + `dist/*.tar.gz` and, if appimagetool can be fetched, `dist/*.AppImage`), `update-mod` (`git pull` the vendored glikvm-mod, then re-run `install`).

Options: `--src <pkg>` (`.dmg`, `.exe`, an install dir / mounted `.app`, or an `app.asar`), `--dest <dir>`, `--mod <dir>` (use your own glikvm-mod checkout instead of `vendor/glikvm-mod`), `--electron <ver>`, `--arch x64|arm64`, `--no-mod` (stock client only, still with the Linux crash fix), `--cache <dir>` (default `~/.cache/glikvm-linux`; Electron downloads honour `ELECTRON_MIRROR`).

**After a new GLKVM release**: download the new package, run `install` again. Every patch (the mod's and this repo's) is anchored on unique snippets of the stock code and aborts loudly if an anchor moved, so a client update can't produce a silently half-patched app. **After updating glikvm-mod** (`update-mod`), re-run `install` too.

## Where things live

| | |
|---|---|
| app (Electron runtime + patched `resources/app`) | `~/.local/share/glkvm-mod/` (`--dest`), launcher `glkvm-mod.sh`, symlink `~/.local/bin/glkvm-mod` |
| menu entry / icon / `glkvm://` handler | `~/.local/share/applications/glkvm-mod.desktop`, `~/.local/share/icons/hicolor/512x512/apps/glkvm-mod.png` |
| login, device list, settings (incl. the mod's) | `~/.config/gl-kvm/GLKVM.json` - the client's own electron-store, same keys as on Windows/macOS |
| logs | `~/.config/gl-kvm/logs/` |
| build marker (what was built from what) | `glikvm-linux.json` inside the app dir; `status` prints it |

## How it works

GLKVM is a thin Electron 34 wrapper (unminified `app.asar`, `nodeIntegration: true`, no native modules): a home window (Vue), one "remote" window whose tabs are `<iframe src="https://<device>">` showing the device's own web UI, and a preload with IPC helpers. The `app.asar` is the same JavaScript on every platform, so a Linux build is: that payload + the stock Linux Electron runtime of the matching version + a handful of patches.

`glikvm-linux.mjs` does, in order:

1. **Extract** `Contents/Resources/app.asar` (+ `app.asar.unpacked`) out of the `.dmg` with 7z (only those paths; also reads the Electron version from the bundled framework's plist), or `resources/app.asar` out of the NSIS `.exe`.
2. **Apply glikvm-mod's patches verbatim** (`vendor/glikvm-mod/src/patches.ts` + `src/inject/*`), then this repo's Linux patches (`src/patches.mjs`):
   * guard `BrowserWindow.hookWindowMessage(278, ...)`, a Windows-only API the stock code calls whenever it is not on macOS - on Linux every window creation would throw;
   * single-instance conflict: on Linux there is no stock client to take over from, so a second start just raises the running one (the mod's PowerShell-based takeover dialog is skipped);
   * a variant of the mod's About-page patch for the macOS-built bundle (its Vue render cache differs from the Windows build in that one spot);
   * hotfix for glikvm-mod 0.1.5 (`STRIP` undefined in `glOnTabDragEnd`, which made tearing a tab out by drag throw) - applied only while the anchor exists, i.e. until it is fixed upstream;
   * displayed version `V1.5.0 r1-linux · ui-mod <ver>` (footer + About) and a `linux <ver>` stamp in About - display only, the update-check copy is untouched.
   Every patched file is syntax-checked.
3. **Fetch Electron** (`@electron/get`, cached) and assemble a self-contained dir: Electron dist with the binary renamed `glkvm-mod`, `resources/app` = the patched app, and `glkvm-mod.sh` which runs it with `--no-sandbox` (the stock client itself passes `no-sandbox`; the unpacked `chrome-sandbox` cannot be setuid without root anyway).
4. **Install**: copy to `--dest`, write the `.desktop` file (`StartupWMClass=gl-kvm`, `MimeType=x-scheme-handler/glkvm` for the OAuth callback), icon, `~/.local/bin` symlink, `xdg-mime default`.

Nothing else in the client is touched: login, cloud relay, local access, webterm, file transfer, screenshots, settings all run as on the other platforms.

## Linux notes / honest limits

* **Wayland**: Electron 34 runs through XWayland by default, which is what the mod's window-drag/merge logic (cursor position, window bounds) needs. `ELECTRON_OZONE_PLATFORM_HINT=auto glkvm-mod` runs native Wayland; window dragging by tab/merging windows will not track the cursor there.
* **Tray**: the client hides to the tray on close by default (*Settings → General → Operation when closing the window*). GNOME needs an AppIndicator extension to show tray icons; without one, launch "GLKVM (mod)" again to bring the hidden window back (single-instance hand-off), or set the close action to *Quit*.
* **System keys**: the Windows build ships a helper that swallows `Win`/`Alt+Tab` while a session is focused; there is no Linux equivalent, so those still go to your desktop (same as macOS).
* **Auto-update** is inert on Linux (the update feed has no Linux entry), which is what you want: update by re-running `install` with a new package.
* **Notifications** (paste failures etc.) use libnotify via Electron; `Ctrl+Alt+V` is intercepted before the device iframe sees it, as on Windows.
* Fonts: the bundle ships Inter/NotoSansSC, so it looks the same as elsewhere; on HiDPI the usual Electron `--force-device-scale-factor` works if your session doesn't set it.
* Tested on Ubuntu (GNOME, Wayland session/XWayland) with the mock device below and against the client 1.5.0 `.dmg`; real RM10 units are reachable exactly like on Windows since the session is the device's own web UI in an iframe.

## Testing without a KVM

`test/mockkvm.mjs` is a fake device (self-signed HTTPS, `/api/auth/check`, a page with a live `<video>` of a chosen resolution, the client handshake, and `/api/hid/print` that records what gets "typed"), and `test/cdp.mjs` drives the running client over the DevTools protocol (screenshots, `window.utils.glFitWindow()`, `glPasteClipboard()`, `glMoveDevice(id, "window"|"tab")`, ...):

```sh
openssl req -x509 -newkey rsa:2048 -nodes -keyout test/key.pem -out test/cert.pem -subj /CN=localhost -days 30
node test/mockkvm.mjs 8443 MockKVM-A 1280 720 &
node test/mockkvm.mjs 8444 MockKVM-B 1024 768 &
~/.local/share/glkvm-mod/glkvm-mod.sh --remote-debugging-port=9333 &
# Local Access -> Add Device -> 127.0.0.1:8443 (and :8444), open them, then e.g.:
node test/cdp.mjs 9333 list
node test/cdp.mjs 9333 eval "require('electron').clipboard.writeText('hello'); window.utils.glPasteClipboard()" view/remote
grep PRINT test/mock-8443.log
```

## Relationship to glikvm-mod

This repo contains no copy of the mod: it clones `emaspa/glikvm-mod` into `vendor/` on first use (or use `--mod` to point at your checkout) and imports its `src/patches.ts` directly. Anything platform-neutral belongs upstream in the mod; only Linux plumbing and build-variant workarounds live here.

## Changelog

**0.1.0** - first release: build/install/run/status/uninstall/package from the 1.5.0 `.dmg` or `.exe`; glikvm-mod 0.1.5 applied; Linux fixes (hookWindowMessage, instance conflict), mac-bundle About variant, STRIP hotfix; tar.gz + AppImage packaging; mock device + CDP test helpers.

## License

MIT, see [LICENSE](LICENSE). Not affiliated with GL-iNet; GLKVM and the client are theirs.
