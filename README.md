# aptPOS

A retail point-of-sale application built with React, Express, SQLite, and Electron.

## Features

- POS register with barcode scanning, payment handling, and receipt printing
- Inventory, sales history, purchases, customers, and vendors
- Cashbook, reporting, and configurable payment methods
- Local SQLite storage and database backup/restore
- Windows desktop application with an assisted NSIS installer

## Requirements

- Node.js 22.12.0 or later
- Windows x64 to build the Windows installer

## Development

```bash
npm install
npm run electron:dev
```

The desktop development command starts the Express/Vite server and Electron. To run only the web application, use `npm run dev` and open `http://localhost:3000`.

## Build the Windows installer

```bash
npm run electron:build
```

The production Vite build, Electron compilation, and NSIS packaging run together. The installer is written to:

```text
release\aptPOS-Setup-1.0.6.exe
```

The installer provides welcome, terms acceptance, installation-mode and folder selection, progress, and completion pages. It creates Start Menu and desktop shortcuts, and offers to launch aptPOS when installation finishes.

The application uses the existing `com.counterline.pos` app identity and `Counterline POS` user-data directory to preserve existing installations. The current project database is not included in the installer. A fresh installation initializes its own database under the Windows application data directory; uninstalling the application leaves business data in place.

## Publishing app updates

The Windows app checks the public `Munfilih/aptpos` GitHub Releases feed from Settings and displays the release notes when an update is found. Install version 1.0.6 manually over installations that cannot start (including version 1.0.4); working updater versions can install it from Settings once the release is published. To publish an update, increment the version in `package.json` and `package-lock.json`, push a matching `v<version>` tag, and let `.github/workflows/publish-release.yml` build and publish the installer, blockmap, update metadata, and generated release notes.

Invoice numbers use the fixed `RCP-` prefix, sales-return vouchers use `SR-`, and KOT numbers use the trailing sequence from their invoice number. Invoice design settings allow per-format top, right, bottom, and left print margins, and KOT printing can be enabled or disabled. There is no separate order-number or document-prefix settings system.

## Project structure

```text
electron/                 Electron main process and secure preload
server/                   SQLite database layer
src/                      React application
build-resources/          App icon, installer artwork, license, and NSIS include
server.ts                 Express API and production static-file server
electron-builder.yml      Windows packaging configuration
```

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Web development server |
| `npm run electron:dev` | Electron with Vite hot reload |
| `npm run build` | Vite production build |
| `npm run electron:compile` | Compile Electron and the server bundle |
| `npm run electron:build` | Build and package the Windows x64 installer |
