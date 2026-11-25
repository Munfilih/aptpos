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

## Demo and license registration

Signing in with the `demo` account checks the current license status with aptPOS User Management before entry. Only an active, unexpired demo can enter; missing, rejected, revoked, or expired access stays logged out and opens registration. **Request Demo Key** sends the installation's system code to the aptPOS User Management portal. After aptadmin approves the request and shares its generated key, enter that key in the same window and select **Activate Demo**. Activation starts a two-day period; the top bar shows the remaining time by the second and returns to registration when it expires. An expired demo can submit an extension request and redeem a newly approved key for another two days. Active sessions recheck status every minute and when the app regains focus, and log out when access is revoked or expires.

An active demo account has access to the regular POS feature set, including sales, inventory, purchases, reports, and standard settings. Aptadmin-only controls such as user management, database maintenance, and app version configuration remain restricted to `aptadmin`. Demo access remains subject to Firebase status checks, expiration, and the offline grace period. The 10-digit numeric system code is derived from a SHA-256 hash of the Windows computer's SMBIOS hardware UUID; the raw UUID is not stored or sent. The code is stable for the same hardware and changes if the hardware UUID changes.

The POS server forwards demo requests, activation, and status checks to the hosted aptPOS User Management API at `https://aptpos-admin-api.onrender.com` by default. Firebase is authoritative for demo status. If the status service cannot be reached, an already verified active demo can continue offline for up to one hour from the first failed check; the POS automatically logs out after that grace period. A successful online check resets the offline grace period. Set `DEMO_PORTAL_API_URL` in the POS server environment to use a different API (for local development, for example, `http://127.0.0.1:3002`). The portal API must be running and configured with Firebase Admin credentials to save requests to the Demo Key Requests queue; a GitHub repository or GitHub Pages site alone does not run its Node service. License-key requests continue to use the local aptadmin review inbox.

The Registration settings page accepts the one-time key created when aptadmin converts an approved demo system in the Auth app. The key is bound to this installation's system code. Activation creates the owner admin account using the username and password entered during conversion; sign out of aptadmin and use that account afterward.

The aptadmin Version settings page loads and saves Soft, Silver, and Standard component policies through the User Management API, which stores them in Firebase. For registration and version policy sync, set the same server-only `VERSION_CONTROL_API_KEY` in the POS and Auth API environments; do not expose it in browser configuration. Version policy updates also require the aptadmin password. Registered systems receive updated access on the next license status check. `DEMO_PORTAL_API_URL` selects the Auth API endpoint.

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

Invoice numbers use the fixed `RCP-` prefix, sales-return vouchers use `SR-`, and KOT numbers use the trailing sequence from their invoice number. Invoice design settings allow per-format top, right, bottom, and left print margins. KOT printing can be enabled or disabled, previews the current ticket before printing, and uses the selected invoice paper width and margins. A dedicated KOT printer can be selected; otherwise KOT follows the invoice printer setting. There is no separate order-number or document-prefix settings system.

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
