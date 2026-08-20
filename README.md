# glikvm-linux

Unofficial Linux GLKVM desktop client (GL-iNet Comet / RM1 / RM10) based on the macOS and Windows packages, with [glikvm-mod](https://github.com/emaspa/glikvm-mod) applied.

This project is a port of the platform-independent app payload from the official `.dmg` / `.exe`, on the Linux Electron runtime, with the mod applied, shipped as an AppImage / tarball you can just run (with in-app updates) or built locally from your own downloaded package. It shows up as **v0.1.2 linux (beta)**; About shows the ui-mod version and which GLKVM release it is ported from (1.5.1 release1 today).

> **Not affiliated with GL-iNet.** This is a community port of their client; GLKVM, the client and its artwork are theirs, and this project is not endorsed or supported by them. The source repository contains only the build tool and patches; the release downloads are convenience builds of their client for Linux.

It has everything the mod adds on Windows:

| Feature | |
|---|---|
| **Sessions in separate windows** | `Shift`+click a device, or set *Open sessions in: A separate window per session* |
| **Tab management like a browser** | reorder tabs by dragging · tear a tab out into its own window · drop a tab on another window's tab strip · combine windows by dragging one onto another's strip · right-click a tab → *Move to its own window* / *Move into the main session window* |
| **"+" new-session button** | at the end of the tab strip: recent sessions, local-access devices, *Choose from device list...* |
| **Paste local clipboard into the remote machine** | `Ctrl+Alt+V` (configurable), or right-click a tab; optional *Slow* paste |
| **1:1 resize to KVM resolution** | button next to fullscreen in the session toolbar, tab menu, or *Always open sessions at 1:1* |
| **Start screen** | open on Remote Access or Local Access; Back from Settings returns to the last access page |
| **Remember session passwords** | opt-in: a *Remember my password* checkbox on the device login screen; stored encrypted by the OS keystore (keyring/libsecret on Linux), auto-filled and submitted next time; turning the setting off wipes them |
| Window titles = device name, geometry inheritance, settings UI under *Settings → General → Sessions (ui-mod)*, mod/port stamps in About | |

## Just run it

Grab the latest release from **[Releases](https://github.com/emaspa/glikvm-linux/releases)**:

* `glkvm-mod-<tag>-linux-x64.AppImage` - `chmod +x`, run. Needs FUSE 2 (`libfuse2`/`fuse2` package on most distros; otherwise `./glkvm-mod-*.AppImage --appimage-extract-and-run`).
* `glkvm-mod-<tag>-linux-x64.tar.gz` - extract anywhere, run `glkvm-mod/glkvm-mod.sh` (add your own menu entry, or use the build tool's `install` below).
* `SHA256SUMS` - checksums of both.

Login/device list/settings go to `~/.config/gl-kvm` (same as the official client would use). No root needed. The release assets contain GL-iNet's client code (that is what a port is); GLKVM and the client remain theirs - see the note above.

### Updates

The app checks this repo's releases 8 s after start and every 6 h (About → **Check for updates** does it on demand). When a newer tag exists it asks (*Update / Later / Skip this version*), downloads the asset for its own install kind, verifies it against `SHA256SUMS`, swaps it in place - the AppImage file itself, or the whole directory for tar.gz / `install` copies - keeps the previous version as `*.old` until the next start, and offers to restart. Set `GLKVM_LINUX_NO_UPDATE_CHECK=1` to disable the automatic check.

## Build it yourself

### Requirements

* Linux x64 (arm64 with `--arch arm64`, untested), glibc-based distro able to run Electron 34 (Ubuntu 22.04+ / Fedora / Arch / ...).
* [Node.js](https://nodejs.org) **24** (≥ 23.6; it loads glikvm-mod's TypeScript patch definitions with Node's built-in type stripping - no bun, no tsc), `git`, and `7z` (`p7zip-full` / `7zip` package) to open the `.dmg`/`.exe`.
* **The official GLKVM package** for macOS (`gl-kvm-<version>.dmg`) or Windows (`GLKVM-Setup-<version>.exe`) from the [GL-iNet app page](https://www.gl-inet.com/en-de/pages/app-rm), placed in this directory (or given with `--src`). Tested with **1.5.1 release1** and 1.5.0 release1 (both Electron 34.5.8).
* No root: everything goes to `~/.local/share/glkvm-mod` and your app menu.

### Install from source

```sh
git clone https://github.com/emaspa/glikvm-linux.git
cd glikvm-linux
npm install
# put gl-kvm-1.5.1-release1.dmg (or the Windows .exe) in this directory, then:
node glikvm-linux.mjs install        # extract + patch + fetch Electron + install + "GLKVM (mod)" menu entry
node glikvm-linux.mjs run            # or launch "GLKVM (mod)" from your app menu, or ~/.local/bin/glkvm-mod
node glikvm-linux.mjs status
node glikvm-linux.mjs uninstall
```

Other commands: `build` (only produce the portable dir `build/glkvm-mod`), `package` (build + `dist/*.tar.gz` + `dist/*.AppImage` + `SHA256SUMS`), `release` (package + publish as the GitHub release `v<version>` with `gh`, marked latest; installed copies pick it up through the in-app updater; `--draft`, `--prerelease`, `--notes "<extra text>"`), `update-mod` (`git pull` the vendored glikvm-mod, then re-run `install`).

Options: `--src <pkg>` (`.dmg`, `.exe`, an install dir / mounted `.app`, or an `app.asar`), `--dest <dir>`, `--mod <dir>` (use your own glikvm-mod checkout instead of `vendor/glikvm-mod`), `--electron <ver>`, `--arch x64|arm64`, `--no-mod` (stock client only, still with the Linux crash fix), `--cache <dir>` (default `~/.cache/glikvm-linux`; Electron downloads honour `ELECTRON_MIRROR`).

**After a new GLKVM release**: download the new package, run `install` again. Every patch (the mod's and this repo's) is anchored on unique snippets of the stock code and aborts loudly if an anchor moved, so a client update can't produce a silently half-patched app. **After updating glikvm-mod** (`update-mod`), re-run `install` too. To ship it to users: bump `LINUX_VERSION`/`LINUX_STAGE` in `src/patches.mjs`, commit, `node glikvm-linux.mjs release`.

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
   * hotfix for glikvm-mod ≤ 0.1.5 (`STRIP` undefined in `glOnTabDragEnd`, which made tearing a tab out by drag throw) - fixed upstream in 0.1.6; the hotfix is applied only while its anchor exists, so it is a no-op with a current mod;
   * version shown as `unofficial v0.1.1 linux (beta)` in the footer and `GLKVM v0.1.1 linux (beta)` as the About title, and the About page replaced by: which GLKVM release it is ported from + ui-mod version, links to this repo and glikvm-mod, and the non-affiliation note - display only, the update-check copy is untouched.
   * the in-app updater (`src/inject/linux-updater.js`, main process) + `window.utils.glLinuxCheckUpdate()` + the About link.
   Every patched file is syntax-checked.
3. **Fetch Electron** (`@electron/get`, cached) and assemble a self-contained dir: Electron dist with the binary renamed `glkvm-mod`, `resources/app` = the patched app, and `glkvm-mod.sh` which runs it with `--no-sandbox` (the stock client itself passes `no-sandbox`; the unpacked `chrome-sandbox` cannot be setuid without root anyway).
4. **Install**: copy to `--dest`, write the `.desktop` file (`StartupWMClass=gl-kvm`, `MimeType=x-scheme-handler/glkvm` for the OAuth callback), icon, `~/.local/bin` symlink, `xdg-mime default`.

Nothing else in the client is touched: login, cloud relay, local access, webterm, file transfer, screenshots, settings all run as on the other platforms.

## Linux notes / honest limits

* **Wayland**: Electron 34 runs through XWayland by default, which is what the mod's window-drag/merge logic (cursor position, window bounds) needs. `ELECTRON_OZONE_PLATFORM_HINT=auto glkvm-mod` runs native Wayland; window dragging by tab/merging windows will not track the cursor there.
* **Tray**: the client hides to the tray on close by default (*Settings → General → Operation when closing the window*). GNOME needs an AppIndicator extension to show tray icons; without one, launch "GLKVM (mod)" again to bring the hidden window back (single-instance hand-off), or set the close action to *Quit*.
* **System keys**: the Windows build ships a helper that swallows `Win`/`Alt+Tab` while a session is focused; there is no Linux equivalent, so those still go to your desktop (same as macOS).
* **GL-iNet's own auto-update** is inert on Linux (their feed has no Linux entry); updates come from this repo's releases via the in-app updater described above.
* **Notifications** (paste failures etc.) use libnotify via Electron; `Ctrl+Alt+V` is intercepted before the device iframe sees it, as on Windows.
* Fonts: the bundle ships Inter/NotoSansSC, so it looks the same as elsewhere; on HiDPI the usual Electron `--force-device-scale-factor` works if your session doesn't set it.
* Tested on Ubuntu (GNOME, Wayland session/XWayland) with the mock device below and against the client 1.5.1 `.dmg`; real RM10 units are reachable exactly like on Windows since the session is the device's own web UI in an iframe.

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

**0.1.2 beta** - GLKVM 1.5.1 + ui-mod 0.1.7: remember session passwords (checkbox on the device login screen, encrypted via the OS keystore, auto-login next time - verified on Linux/keyring); the default `--src` now picks the newest package in the directory; mock device grew a login page for testing the flow.

**0.1.1 beta** - wording: "Unofficial" in the About page and the footer (`unofficial v0.1.1 linux (beta)`), About lists both repos and has *Check for updates*; first release published through the in-app updater path.

**0.1.0 beta** - first release: build/install/run/status/uninstall/package/release from the 1.5.0 `.dmg` or `.exe`; glikvm-mod 0.1.6 applied; Linux fixes (hookWindowMessage, instance conflict), mac-bundle About variant, STRIP hotfix; AppImage + tar.gz releases with SHA256SUMS and an in-app updater; mock device + CDP test helpers.

## Licensing

* **This repository** (build tool, patches, injected code, test helpers): MIT, see [LICENSE](LICENSE).
* **glikvm-mod**: MIT ([emaspa/glikvm-mod](https://github.com/emaspa/glikvm-mod)).
* **The GLKVM desktop client** whose payload the releases contain: © GL Technologies (HK) Ltd., all rights reserved, no open-source license (the client's source is not published; it is distinct from GL-iNet's GPL-3.0 device firmware [gl-inet/glkvm](https://github.com/gl-inet/glkvm), none of which is included here). Its third-party components are MIT/BSD (ant-design-vue, marked, electron-store, ...). The release builds are provided as an unofficial convenience for Linux users; if GL-iNet asks for them to be taken down they will be, and building locally from your own downloaded package (above) needs nothing from this repo's releases.
* **Electron** 34 (MIT) and **Chromium** (BSD) - their notices ship in the app dir as `LICENSE` and `LICENSES.chromium.html`.

Not affiliated with, endorsed or supported by GL-iNet.
