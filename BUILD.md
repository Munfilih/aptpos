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

Output: `release\aptPOS-Setup-1.0.0.exe`

## Rebuild after source changes

```bash
npm run electron:build
```

To clean all build artefacts first:

```bash
npm run clean && npm run electron:build
```

## Window behaviour

- Launches maximized to fill the primary display's work area
- F11 toggles full-screen; Esc exits full-screen
- Minimum window size: 900 × 640
