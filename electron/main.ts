import { app, BrowserWindow, dialog, ipcMain, safeStorage, screen, shell, type IpcMainInvokeEvent } from 'electron';
import electronUpdater from 'electron-updater';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
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
let closeApproved = false;
let closeRequestPending = false;
let closeHandlingPending = false;
let scheduledBackupTimer: ReturnType<typeof setInterval> | null = null;
let scheduledBackupCheckPending = false;
let lastScheduledBackupAttemptDate = '';
let backupInProgress: Promise<BackupResult> | null = null;

interface BackupPreferences {
  directory?: string;
  mode?: 'on-close' | 'manual' | 'scheduled';
  scheduledTime?: string;
  lastScheduledBackupDate?: string;
  googleDriveClientId?: string;
  encryptedGoogleDriveRefreshToken?: string;
}

type BackupMode = NonNullable<BackupPreferences['mode']>;
type BackupResult = { filePath: string; googleDriveUploaded: boolean };

const DEFAULT_BACKUP_MODE: BackupMode = 'on-close';
const DEFAULT_SCHEDULED_BACKUP_TIME = '02:00';

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

async function checkForUpdates(): Promise<UpdateStatus> {
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

function getDefaultBackupDirectory(): string {
  return path.join(app.getPath('documents'), 'aptPOS Backups');
}

function getBackupPreferencesPath(): string {
  return path.join(app.getPath('userData'), 'backup-preferences.json');
}

async function readBackupPreferences(): Promise<BackupPreferences> {
  try {
    const rawPreferences = await readFile(getBackupPreferencesPath(), 'utf8');
    const parsed: unknown = JSON.parse(rawPreferences);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Saved backup settings are invalid.');
    }
    if (
      ('directory' in parsed && (
        typeof parsed.directory !== 'string' || !path.isAbsolute(parsed.directory)
      )) ||
      ('mode' in parsed &&
        parsed.mode !== 'on-close' && parsed.mode !== 'manual' && parsed.mode !== 'scheduled') ||
      ('scheduledTime' in parsed &&
        (typeof parsed.scheduledTime !== 'string' ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(parsed.scheduledTime))) ||
      ('lastScheduledBackupDate' in parsed && typeof parsed.lastScheduledBackupDate !== 'string') ||
      ('googleDriveClientId' in parsed && typeof parsed.googleDriveClientId !== 'string') ||
      ('encryptedGoogleDriveRefreshToken' in parsed &&
        typeof parsed.encryptedGoogleDriveRefreshToken !== 'string')
    ) {
      throw new Error('Saved backup settings are invalid.');
    }

    return {
      ...('directory' in parsed && typeof parsed.directory === 'string'
        ? { directory: parsed.directory }
        : {}),
      ...('mode' in parsed &&
      (parsed.mode === 'on-close' || parsed.mode === 'manual' || parsed.mode === 'scheduled')
        ? { mode: parsed.mode }
        : {}),
      ...('scheduledTime' in parsed && typeof parsed.scheduledTime === 'string'
        ? { scheduledTime: parsed.scheduledTime }
        : {}),
      ...('lastScheduledBackupDate' in parsed && typeof parsed.lastScheduledBackupDate === 'string'
        ? { lastScheduledBackupDate: parsed.lastScheduledBackupDate }
        : {}),
      ...('googleDriveClientId' in parsed && typeof parsed.googleDriveClientId === 'string'
        ? { googleDriveClientId: parsed.googleDriveClientId }
        : {}),
      ...('encryptedGoogleDriveRefreshToken' in parsed &&
      typeof parsed.encryptedGoogleDriveRefreshToken === 'string'
        ? { encryptedGoogleDriveRefreshToken: parsed.encryptedGoogleDriveRefreshToken }
        : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function writeBackupPreferences(preferences: BackupPreferences): Promise<void> {
  const preferencesPath = getBackupPreferencesPath();
  await mkdir(path.dirname(preferencesPath), { recursive: true });
  await writeFile(preferencesPath, JSON.stringify(preferences, null, 2), 'utf8');
}

async function getBackupDirectory(): Promise<string> {
  const preferences = await readBackupPreferences();
  return preferences.directory || getDefaultBackupDirectory();
}

function isBackupMode(value: unknown): value is BackupMode {
  return value === 'on-close' || value === 'manual' || value === 'scheduled';
}

async function getBackupConfiguration(): Promise<{
  directory: string;
  mode: BackupMode;
  scheduledTime: string;
}> {
  const preferences = await readBackupPreferences();
  return {
    directory: preferences.directory || getDefaultBackupDirectory(),
    mode: preferences.mode || DEFAULT_BACKUP_MODE,
    scheduledTime: preferences.scheduledTime || DEFAULT_SCHEDULED_BACKUP_TIME,
  };
}

async function saveBackupConfiguration(modeValue: unknown, timeValue: unknown): Promise<{
  directory: string;
  mode: BackupMode;
  scheduledTime: string;
}> {
  if (!isBackupMode(modeValue)) throw new Error('Backup mode is invalid.');
  if (typeof timeValue !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeValue)) {
    throw new Error('Scheduled backup time is invalid.');
  }

  const preferences = await readBackupPreferences();
  await writeBackupPreferences({
    ...preferences,
    mode: modeValue,
    scheduledTime: timeValue,
  });
  return getBackupConfiguration();
}

async function saveBackupDirectory(directory: string): Promise<void> {
  if (!path.isAbsolute(directory)) {
    throw new Error('Backup folder path must be absolute.');
  }
  const preferences = await readBackupPreferences();
  await writeBackupPreferences({
    ...preferences,
    directory,
  });
}

async function readGoogleResponse(
  response: Response,
  operation: string
): Promise<Record<string, unknown>> {
  const responseText = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error(`${operation} returned an invalid response (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    const detail =
      typeof payload === 'object' && payload !== null && 'error_description' in payload &&
      typeof payload.error_description === 'string'
        ? payload.error_description
        : typeof payload === 'object' && payload !== null && 'error' in payload &&
          typeof payload.error === 'string'
          ? payload.error
          : `HTTP ${response.status}`;
    throw new Error(`${operation} failed: ${detail}`);
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error(`${operation} returned an invalid response.`);
  }
  return payload as Record<string, unknown>;
}

async function getGoogleDriveAuthorizationCode(
  clientId: string,
  state: string,
  verifier: string
): Promise<{ code: string; redirectUri: string }> {
  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Could not start the Google Drive sign-in callback.');
  }

  const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.file',
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let completeAuthorization: (result: { code: string } | { error: Error }) => void = () => {};
  const authorizationCode = new Promise<string>((resolve, reject) => {
    completeAuthorization = (result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      server.removeListener('request', onRequest);
      server.close();
      if ('error' in result) reject(result.error);
      else resolve(result.code);
    };

    const onRequest = (request: http.IncomingMessage, response: http.ServerResponse) => {
      const callbackUrl = new URL(request.url || '/', `http://127.0.0.1:${address.port}`);
      if (callbackUrl.pathname !== '/oauth2callback') {
        response.writeHead(404);
        response.end('Not found.');
        return;
      }

      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      if (callbackUrl.searchParams.get('state') !== state) {
        response.writeHead(400);
        response.end('Google Drive authorization failed. Return to aptPOS.');
        completeAuthorization({ error: new Error('Google Drive authorization response was invalid.') });
        return;
      }

      const oauthError = callbackUrl.searchParams.get('error');
      if (oauthError) {
        response.writeHead(400);
        response.end('Google Drive authorization was not completed. Return to aptPOS.');
        completeAuthorization({
          error: new Error(
            oauthError === 'access_denied'
              ? 'Google Drive connection was cancelled.'
              : 'Google Drive authorization failed.'
          ),
        });
        return;
      }

      const code = callbackUrl.searchParams.get('code');
      if (!code) {
        response.writeHead(400);
        response.end('Google Drive authorization did not return a code. Return to aptPOS.');
        completeAuthorization({ error: new Error('Google Drive authorization did not return a code.') });
        return;
      }

      response.writeHead(200);
      response.end('Google Drive is connected. You can return to aptPOS.');
      completeAuthorization({ code });
    };
    server.on('request', onRequest);
    timeout = setTimeout(() => {
      completeAuthorization({ error: new Error('Google Drive connection timed out.') });
    }, 5 * 60 * 1000);
  });

  try {
    await shell.openExternal(authorizationUrl.toString());
    return { code: await authorizationCode, redirectUri };
  } catch (error) {
    if (!settled) {
      settled = true;
      if (timeout) clearTimeout(timeout);
      server.close();
    }
    throw error;
  }
}

async function connectGoogleDrive(clientIdValue: unknown): Promise<{ clientId: string; connected: true }> {
  const clientId = typeof clientIdValue === 'string' ? clientIdValue.trim() : '';
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error('Enter a valid Google OAuth Desktop app Client ID.');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is unavailable on this device.');
  }

  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(32).toString('hex');
  const { code, redirectUri } = await getGoogleDriveAuthorizationCode(clientId, state, verifier);
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  const tokenPayload = await readGoogleResponse(tokenResponse, 'Google Drive token exchange');
  const refreshToken = tokenPayload.refresh_token;
  if (typeof refreshToken !== 'string' || !refreshToken) {
    throw new Error('Google did not provide a refresh token. Disconnect and reconnect Google Drive.');
  }

  const preferences = await readBackupPreferences();
  await writeBackupPreferences({
    ...preferences,
    googleDriveClientId: clientId,
    encryptedGoogleDriveRefreshToken: safeStorage.encryptString(refreshToken).toString('base64'),
  });
  return { clientId, connected: true };
}

async function uploadBackupToGoogleDrive(buffer: Buffer, fileName: string): Promise<void> {
  const preferences = await readBackupPreferences();
  if (!preferences.googleDriveClientId || !preferences.encryptedGoogleDriveRefreshToken) {
    throw new Error('Google Drive is not connected.');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is unavailable on this device.');
  }

  const refreshToken = safeStorage.decryptString(
    Buffer.from(preferences.encryptedGoogleDriveRefreshToken, 'base64')
  );
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: preferences.googleDriveClientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const tokenPayload = await readGoogleResponse(tokenResponse, 'Google Drive token refresh');
  const accessToken = tokenPayload.access_token;
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new Error('Google did not return an access token.');
  }

  const boundary = `aptpos-${randomBytes(16).toString('hex')}`;
  const metadata = JSON.stringify({ name: fileName, mimeType: 'application/x-sqlite3' });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: application/x-sqlite3\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const uploadResponse = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  if (!uploadResponse.ok) {
    const detail = (await uploadResponse.text()).slice(0, 400).trim();
    throw new Error(detail || `Google Drive upload failed (HTTP ${uploadResponse.status}).`);
  }
}

async function performLocalDatabaseBackup(): Promise<BackupResult> {
  if (!trustedOrigin) throw new Error('The local POS server is not ready.');
  const response = await fetch(new URL('/api/database/backup', trustedOrigin));
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400).trim();
    throw new Error(detail || `Database backup failed (HTTP ${response.status}).`);
  }

  const backup = Buffer.from(await response.arrayBuffer());
  if (backup.length === 0) throw new Error('The database backup was empty.');

  const directory = await getBackupDirectory();
  await mkdir(directory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(directory, `aptpos-backup-${timestamp}.sqlite`);
  await writeFile(filePath, backup, { flag: 'wx' });
  const preferences = await readBackupPreferences();
  if (preferences.googleDriveClientId && preferences.encryptedGoogleDriveRefreshToken) {
    try {
      await uploadBackupToGoogleDrive(backup, path.basename(filePath));
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown Google Drive error.';
      throw new Error(`Local backup saved to ${filePath}, but Google Drive upload failed: ${detail}`);
    }
    return { filePath, googleDriveUploaded: true };
  }
  return { filePath, googleDriveUploaded: false };
}

function createLocalDatabaseBackup(): Promise<BackupResult> {
  if (backupInProgress) return backupInProgress;
  const operation = performLocalDatabaseBackup();
  backupInProgress = operation;
  void operation.then(
    () => {
      if (backupInProgress === operation) backupInProgress = null;
    },
    () => {
      if (backupInProgress === operation) backupInProgress = null;
    }
  );
  return operation;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function runScheduledBackupIfDue(): Promise<void> {
  if (scheduledBackupCheckPending) return;
  scheduledBackupCheckPending = true;
  try {
    const preferences = await readBackupPreferences();
    if ((preferences.mode || DEFAULT_BACKUP_MODE) !== 'scheduled') return;

    const scheduledTime = preferences.scheduledTime || DEFAULT_SCHEDULED_BACKUP_TIME;
    const [scheduledHour, scheduledMinute] = scheduledTime.split(':').map(Number);
    const now = new Date();
    const today = localDateKey(now);
    const currentMinute = now.getHours() * 60 + now.getMinutes();
    if (
      currentMinute < scheduledHour * 60 + scheduledMinute ||
      preferences.lastScheduledBackupDate === today ||
      lastScheduledBackupAttemptDate === today
    ) {
      return;
    }

    lastScheduledBackupAttemptDate = today;
    try {
      const result = await createLocalDatabaseBackup();
      const latestPreferences = await readBackupPreferences();
      await writeBackupPreferences({
        ...latestPreferences,
        lastScheduledBackupDate: today,
      });
      console.info(
        `Scheduled database backup saved to ${result.filePath}` +
        `${result.googleDriveUploaded ? ' and uploaded to Google Drive.' : '.'}`
      );
    } catch (error) {
      console.error('Scheduled database backup failed:', error);
    }
  } catch (error) {
    console.error('Could not check scheduled backup settings:', error);
  } finally {
    scheduledBackupCheckPending = false;
  }
}

function requestCloseConfirmation(): void {
  if (!mainWindow || mainWindow.isDestroyed() || closeRequestPending) return;
  closeRequestPending = true;
  mainWindow.webContents.send('pos:app:close-requested');
}

async function handleAppCloseAttempt(): Promise<void> {
  if (
    closeApproved ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    closeHandlingPending ||
    closeRequestPending
  ) {
    return;
  }

  closeHandlingPending = true;
  try {
    const preferences = await readBackupPreferences();
    if ((preferences.mode || DEFAULT_BACKUP_MODE) === 'on-close') {
      requestCloseConfirmation();
      return;
    }

    closeApproved = true;
    mainWindow?.close();
  } catch (error) {
    console.error('Could not read backup mode before closing:', error);
    requestCloseConfirmation();
  } finally {
    closeHandlingPending = false;
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
  mainWindow.on('close', (event) => {
    if (closeApproved) return;
    event.preventDefault();
    void handleAppCloseAttempt();
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
  return checkForUpdates();
});

ipcMain.handle('pos:updates:install', (event) => {
  assertTrustedSender(event);
  if (updateStatus.state !== 'downloaded') {
    throw new Error('No downloaded update is ready to install.');
  }
  closeApproved = true;
  publishUpdateStatus({ state: 'installing' });
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('pos:backup:get-directory', (event) => {
  assertTrustedSender(event);
  return getBackupDirectory();
});

ipcMain.handle('pos:backup:get-configuration', (event) => {
  assertTrustedSender(event);
  return getBackupConfiguration();
});

ipcMain.handle('pos:backup:set-configuration', async (event, rawConfiguration: unknown) => {
  assertTrustedSender(event);
  if (!rawConfiguration || typeof rawConfiguration !== 'object') {
    throw new Error('Backup settings are invalid.');
  }
  const configuration = rawConfiguration as { mode?: unknown; scheduledTime?: unknown };
  const saved = await saveBackupConfiguration(configuration.mode, configuration.scheduledTime);
  void runScheduledBackupIfDue();
  return saved;
});

ipcMain.handle('pos:backup:choose-directory', async (event) => {
  assertTrustedSender(event);
  const currentDirectory = await getBackupDirectory();
  let defaultPath = currentDirectory;
  try {
    if (!(await stat(currentDirectory)).isDirectory()) {
      defaultPath = path.dirname(currentDirectory);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    defaultPath = path.dirname(currentDirectory);
  }
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
    title: 'Choose Backup Folder',
    defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled) return null;

  const directory = filePaths[0];
  if (!directory) return null;
  await saveBackupDirectory(directory);
  return directory;
});

ipcMain.handle('pos:backup:create', (event) => {
  assertTrustedSender(event);
  return createLocalDatabaseBackup();
});

ipcMain.handle('pos:drive:get-status', async (event) => {
  assertTrustedSender(event);
  const preferences = await readBackupPreferences();
  return {
    clientId: preferences.googleDriveClientId || '',
    connected: Boolean(preferences.encryptedGoogleDriveRefreshToken),
  };
});

ipcMain.handle('pos:drive:connect', async (event, clientId: unknown) => {
  assertTrustedSender(event);
  return connectGoogleDrive(clientId);
});

ipcMain.handle('pos:drive:disconnect', async (event) => {
  assertTrustedSender(event);
  const preferences = await readBackupPreferences();
  await writeBackupPreferences({
    ...(preferences.directory ? { directory: preferences.directory } : {}),
    ...(preferences.googleDriveClientId
      ? { googleDriveClientId: preferences.googleDriveClientId }
      : {}),
  });
  return {
    clientId: preferences.googleDriveClientId || '',
    connected: false,
  };
});

ipcMain.handle('pos:app:resolve-close', (event, shouldClose: unknown) => {
  assertTrustedSender(event);
  if (typeof shouldClose !== 'boolean') {
    throw new Error('Close confirmation choice is invalid.');
  }
  if (!closeRequestPending) return false;

  closeRequestPending = false;
  if (shouldClose) {
    closeApproved = true;
    mainWindow?.close();
  }
  return true;
});

app.on('before-quit', (event) => {
  if (!closeApproved && mainWindow && !mainWindow.isDestroyed()) {
    event.preventDefault();
    void handleAppCloseAttempt();
    return;
  }
  if (scheduledBackupTimer) {
    clearInterval(scheduledBackupTimer);
    scheduledBackupTimer = null;
  }
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
      if (app.isPackaged) {
        setTimeout(() => {
          void checkForUpdates();
        }, 5000);
      }
      void runScheduledBackupIfDue();
      scheduledBackupTimer = setInterval(() => {
        void runScheduledBackupIfDue();
      }, 60_000);
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
