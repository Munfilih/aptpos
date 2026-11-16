import { app, BrowserWindow, dialog, ipcMain, screen, shell, type IpcMainInvokeEvent } from 'electron';
import electronUpdater from 'electron-updater';
import { readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import http from 'http';
import { fileURLToPath, pathToFileURL } from 'url';
import type { Server } from 'http';
import type { UpdateStatus } from './updateStatus.js';

const { autoUpdater } = electronUpdater;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRODUCTION_PORT = 43187;
const LEGACY_APP_NAME = 'Counterline POS';
const isDev = !app.isPackaged && !!process.env.ELECTRON_START_URL;

app.setName(LEGACY_APP_NAME);
app.setAppUserModelId('com.counterline.pos');

let mainWindow: BrowserWindow | null = null;
let backendServer: Server | null = null;
let trustedOrigin = '';
let updateStatus: UpdateStatus = { state: 'idle' };
let currentReleaseNotes: string | undefined;

function normalizeReleaseNotes(releaseNotes: unknown): string | undefined {
  if (typeof releaseNotes === 'string') return releaseNotes.trim() || undefined;
  if (!Array.isArray(releaseNotes)) return undefined;

  const notes = releaseNotes.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const note = 'note' in entry && typeof entry.note === 'string' ? entry.note.trim() : '';
    const version = 'version' in entry && typeof entry.version === 'string' ? entry.version.trim() : '';
    return note ? [`${version ? `v${version}\n` : ''}${note}`] : [];
  });
  return notes.length ? notes.join('\n\n') : undefined;
}

function publishUpdateStatus(status: UpdateStatus): void {
  updateStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pos:updates:status', status);
  }
}

function initializeAutoUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    currentReleaseNotes = undefined;
    publishUpdateStatus({ state: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    currentReleaseNotes = normalizeReleaseNotes(info.releaseNotes);
    publishUpdateStatus({
      state: 'available',
      version: info.version,
      ...(currentReleaseNotes ? { releaseNotes: currentReleaseNotes } : {}),
    });
  });
  autoUpdater.on('update-not-available', (info) => {
    currentReleaseNotes = undefined;
    publishUpdateStatus({ state: 'up-to-date', version: info.version });
  });
  autoUpdater.on('download-progress', (progress) => {
    publishUpdateStatus({
      state: 'downloading',
      version: updateStatus.state === 'available' || updateStatus.state === 'downloading'
        ? updateStatus.version
        : app.getVersion(),
      percent: Number.isFinite(progress.percent)
        ? Math.max(0, Math.min(100, progress.percent))
        : 0,
      ...(currentReleaseNotes ? { releaseNotes: currentReleaseNotes } : {}),
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    currentReleaseNotes = normalizeReleaseNotes(info.releaseNotes) ?? currentReleaseNotes;
    publishUpdateStatus({
      state: 'downloaded',
      version: info.version,
      ...(currentReleaseNotes ? { releaseNotes: currentReleaseNotes } : {}),
    });
  });
  autoUpdater.on('error', (error) => {
    console.error('Application update check failed:', error);
    publishUpdateStatus({
      state: 'error',
      message: error.message || 'The update check failed. Please try again later.',
    });
  });
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  let senderOrigin = '';
  try {
    senderOrigin = new URL(event.senderFrame?.url || '').origin;
  } catch {
    throw new Error('This application action is unavailable to this page.');
  }

  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame ||
    senderOrigin !== trustedOrigin
  ) {
    throw new Error('This application action is unavailable to this page.');
  }
}

function openExternalUrl(url: string): void {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') return;
    void shell.openExternal(parsedUrl.toString()).catch((error: unknown) => {
      console.error('Failed to open external link:', error);
    });
  } catch (error) {
    console.error('Rejected an invalid external link:', error);
  }
}

async function startBackendServer(): Promise<number> {
  process.env.NODE_ENV = 'production';
  process.env.POS_DATA_DIR = path.join(app.getPath('userData'), 'data');
  process.env.POS_PORT = String(PRODUCTION_PORT);
  process.env.POS_HOST = '127.0.0.1';
  process.env.POS_SERVER_AUTOSTART = 'false';
  delete process.env.POS_TEMPLATE_DB;

  const serverModulePath = pathToFileURL(path.join(__dirname, 'server.js')).href;
  const serverModule = await import(serverModulePath) as { startServer: () => Promise<Server> };
  backendServer = await serverModule.startServer();
  return PRODUCTION_PORT;
}

function waitForServer(url: string, retries = 30): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const check = () => {
      let retryScheduled = false;
      const retry = () => {
        if (retryScheduled) return;
        retryScheduled = true;
        attempts += 1;
        if (attempts >= retries) {
          reject(new Error(`The local application server at ${url} did not become ready.`));
        } else {
          setTimeout(check, 300);
        }
      };

      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode === 200) {
          resolve();
        } else {
          retry();
        }
      });
      request.setTimeout(1500, () => request.destroy(new Error('Server health check timed out.')));
      request.on('error', retry);
    };

    check();
  });
}

function createWindow(targetUrl: string): void {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'aptpos.ico')
    : path.resolve(__dirname, '../build-resources/aptpos.ico');

  const { workArea } = screen.getPrimaryDisplay();
  trustedOrigin = new URL(targetUrl).origin;
  mainWindow = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    minWidth: 900,
    minHeight: 640,
    title: 'aptPOS',
    icon: iconPath,
    backgroundColor: '#f8fafc',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    let targetOrigin = '';
    try {
      targetOrigin = new URL(url).origin;
    } catch {
      event.preventDefault();
      return;
    }

    if (targetOrigin !== trustedOrigin) {
      event.preventDefault();
      openExternalUrl(url);
    }
  });

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (!mainWindow) return;
    if (input.type === 'keyDown' && input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
    if (input.type === 'keyDown' && input.key === 'Escape' && mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize();
    mainWindow?.show();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  void mainWindow.loadURL(targetUrl);
}

ipcMain.handle('pos:choose-product-image', async (event) => {
  assertTrustedSender(event);
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
    title: 'Choose Product Image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  });
  return canceled ? null : filePaths[0] || null;
});

ipcMain.handle('pos:read-product-image', async (event, rawPath: unknown) => {
  assertTrustedSender(event);
  const imagePath = typeof rawPath === 'string' ? rawPath : '';
  if (!path.isAbsolute(imagePath)) throw new Error('Product image path must be absolute.');

  const mimeTypeByExtension: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  const mimeType = mimeTypeByExtension[path.extname(imagePath).toLowerCase()];
  if (!mimeType) throw new Error('Product image must be a JPG, PNG, or WebP file.');

  const fileStats = await stat(imagePath);
  if (!fileStats.isFile() || fileStats.size > 10 * 1024 * 1024) {
    throw new Error('Product image must be a file smaller than 10 MB.');
  }

  const imageBuffer = await readFile(imagePath);
  if (imageBuffer.length > 10 * 1024 * 1024) {
    throw new Error('Product image must be a file smaller than 10 MB.');
  }
  const isValidImage =
    (mimeType === 'image/jpeg' && imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8 && imageBuffer[2] === 0xff) ||
    (mimeType === 'image/png' && imageBuffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mimeType === 'image/webp' && imageBuffer.toString('ascii', 0, 4) === 'RIFF' && imageBuffer.toString('ascii', 8, 12) === 'WEBP');
  if (!isValidImage) throw new Error('The selected file is not a valid image.');

  return `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
});

ipcMain.handle('pos:list-printers', async (event) => {
  assertTrustedSender(event);
  const printers = await mainWindow!.webContents.getPrintersAsync();
  return printers.map((printer) => ({
    name: printer.name,
    displayName: printer.displayName || printer.name,
  }));
});

ipcMain.handle('pos:print-receipt', async (event, rawOptions: unknown) => {
  assertTrustedSender(event);
  if (!rawOptions || typeof rawOptions !== 'object') {
    throw new Error('Printer options are invalid.');
  }
  const options = rawOptions as {
    silent?: unknown;
    printerName?: unknown;
    pageSize?: unknown;
  };
  let pageSize: { width: number; height: number } | undefined;
  if (
    (options.silent !== undefined && typeof options.silent !== 'boolean') ||
    (options.printerName !== undefined && typeof options.printerName !== 'string')
  ) {
    throw new Error('Printer options are invalid.');
  }
  if (options.pageSize !== undefined) {
    if (!options.pageSize || typeof options.pageSize !== 'object') {
      throw new Error('Printer page size is invalid.');
    }
    const candidate = options.pageSize as { width?: unknown; height?: unknown };
    if (
      typeof candidate.width !== 'number' ||
      typeof candidate.height !== 'number' ||
      !Number.isFinite(candidate.width) ||
      !Number.isFinite(candidate.height) ||
      candidate.width < 30000 ||
      candidate.width > 100000 ||
      candidate.height < 10000 ||
      candidate.height > 2000000
    ) {
      throw new Error('Printer page size is invalid.');
    }
    pageSize = {
      width: Math.round(candidate.width),
      height: Math.round(candidate.height),
    };
  }
  const printerName = typeof options.printerName === 'string' ? options.printerName : undefined;

  return new Promise((resolve) => {
    mainWindow!.webContents.print(
      {
        silent: options.silent === true,
        ...(printerName ? { deviceName: printerName } : {}),
        ...(pageSize ? { pageSize } : {}),
        printBackground: true,
        margins: { marginType: 'none' },
      },
      (success, failureReason) => resolve({ ok: success, error: failureReason })
    );
  });
});

ipcMain.handle('pos:export-report-pdf', async (event, rawOptions: unknown) => {
  assertTrustedSender(event);
  const options = rawOptions && typeof rawOptions === 'object'
    ? rawOptions as { fileName?: unknown }
    : {};
  const safeFileName = String(options.fileName || 'sales-report.pdf').replace(
    /[<>:"/\\|?*\x00-\x1F]/g,
    '-'
  );
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
    title: 'Export report as PDF',
    defaultPath: safeFileName.endsWith('.pdf') ? safeFileName : `${safeFileName}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { canceled: true };

  const pdf = await mainWindow!.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { top: 0.35, bottom: 0.35, left: 0.35, right: 0.35 },
    preferCSSPageSize: true,
  });
  await writeFile(filePath, pdf);
  return { canceled: false, filePath };
});

ipcMain.handle('pos:share-receipt-whatsapp', async (event, rawOptions: unknown) => {
  assertTrustedSender(event);
  if (!rawOptions || typeof rawOptions !== 'object') {
    throw new Error('Receipt sharing options are invalid.');
  }
  const options = rawOptions as { phone?: unknown; receiptNumber?: unknown };
  const phone = typeof options.phone === 'string' ? options.phone : '';
  if (!/^[1-9]\d{7,14}$/.test(phone)) {
    throw new Error('Enter a valid phone number with country code and without the + sign.');
  }

  const safeReceiptNumber = String(options.receiptNumber || 'receipt').replace(
    /[<>:"/\\|?*\x00-\x1F]/g,
    '-'
  );
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save invoice PDF for WhatsApp',
    defaultPath: `receipt-${safeReceiptNumber}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { canceled: true };

  const pdf = await mainWindow!.webContents.printToPDF({
    printBackground: true,
    margins: { marginType: 'none' },
    preferCSSPageSize: true,
  });
  await writeFile(filePath, pdf);
  try {
    await shell.openExternal(`whatsapp://send?phone=${phone}`);
  } catch {
    await shell.openExternal(`https://wa.me/${phone}`);
  }
  shell.showItemInFolder(filePath);
  return { canceled: false, filePath };
});

ipcMain.handle('pos:updates:get-status', (event) => {
  assertTrustedSender(event);
  return updateStatus;
});

ipcMain.handle('pos:updates:check', async (event) => {
  assertTrustedSender(event);
  if (!app.isPackaged) {
    publishUpdateStatus({
      state: 'error',
      message: 'Updates can only be checked from the installed desktop application.',
    });
    return updateStatus;
  }

  if (updateStatus.state === 'checking' || updateStatus.state === 'available' ||
      updateStatus.state === 'downloading' || updateStatus.state === 'installing') {
    return updateStatus;
  }

  publishUpdateStatus({ state: 'checking' });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The update check failed.';
    publishUpdateStatus({ state: 'error', message });
  }
  return updateStatus;
});

ipcMain.handle('pos:updates:install', (event) => {
  assertTrustedSender(event);
  if (updateStatus.state !== 'downloaded') {
    throw new Error('No downloaded update is ready to install.');
  }
  publishUpdateStatus({ state: 'installing' });
  autoUpdater.quitAndInstall(false, true);
});

app.on('before-quit', () => {
  if (!backendServer) return;
  backendServer.close((error) => {
    if (error) console.error('Failed to stop the local application server:', error);
  });
  backendServer = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      initializeAutoUpdater();
      const port = isDev ? 3000 : await startBackendServer();
      const targetUrl = isDev
        ? process.env.ELECTRON_START_URL!
        : `http://127.0.0.1:${port}`;
      await waitForServer(`${new URL(targetUrl).origin}/api/health`);
      createWindow(targetUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown startup error.';
      console.error('Failed to start aptPOS:', error);
      dialog.showErrorBox('aptPOS could not start', message);
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && trustedOrigin) {
      createWindow(trustedOrigin);
    }
  });
}
