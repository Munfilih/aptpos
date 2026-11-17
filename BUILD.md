# aptPOS Build Guide

## Requirements

- Node.js 22.12.0 or later
- Windows x64 (required for the NSIS installer)

## Install dependencies

```bash
npm install
```

## Development

```bash
npm run electron:dev
```

Starts the Express/Vite dev server and Electron together. Hot-reload is active.

## Web-only development (no Electron)

```bash
npm run dev
```

Open `http://localhost:3000` in a browser.

## Build the Windows installer

```bash
npm run electron:build
```

Runs in sequence:
1. `vite build` — production React bundle → `dist/`
2. `electron:compile` — TypeScript → `dist-electron/` + esbuild server bundle
3. `electron-builder --win nsis --x64` — packages and creates the NSIS installer

Output: `release\aptPOS-Setup-<version>.exe` (version is read from `package.json`; current: `1.0.16`)

## Thermal receipt sizing

Thermal jobs use a content-measured page height and a fixed 58 mm or 80 mm width. Electron receives dimensions in microns (58,000 or 80,000 wide); the height is converted from the rendered CSS-pixel height with a 1 mm trailing allowance. Printing uses 100% scale and no software margins. A driver option such as Epson's “Roll Paper 80 x 3276 mm” is a maximum roll length, not the height used for each receipt.

## Rebuild after source changes

```bash
npm run electron:build
```

To clean all build artefacts first:

```bash
npm run clean && npm run electron:build
```

## GitHub releases and app updates

Packaged apps check the configured GitHub Releases feed on startup and can also check from Settings. The app asks before downloading an available update; users can also start the download from Settings.

To publish a release, update the version in `package.json` and `package-lock.json`, then push a matching tag such as `v1.0.16`. The `.github/workflows/publish-release.yml` workflow builds the Windows installer and publishes the installer and update metadata to GitHub Releases.

## Window behaviour

- Launches maximized to fill the primary display's work area
- F11 toggles full-screen; Esc exits full-screen
- Minimum window size: 900 × 640
