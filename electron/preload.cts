import { contextBridge, ipcRenderer } from 'electron';
import type { UpdateStatus } from './updateStatus.js' with { 'resolution-mode': 'import' };

let pendingCloseRequest = false;
const closeRequestListeners = new Set<() => void>();

ipcRenderer.on('pos:app:close-requested', () => {
  if (closeRequestListeners.size === 0) {
    pendingCloseRequest = true;
    return;
  }
  closeRequestListeners.forEach((listener) => listener());
});

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  chooseProductImage: () => ipcRenderer.invoke('pos:choose-product-image'),
  readProductImage: (imagePath: string) => ipcRenderer.invoke('pos:read-product-image', imagePath),
  listPrinters: () => ipcRenderer.invoke('pos:list-printers'),
  printReceipt: (options?: {
    silent?: boolean;
    printerName?: string;
    pageSize?: { width: number; height: number };
    html?: string;
  }) =>
    ipcRenderer.invoke('pos:print-receipt', options || {}),
  exportPdf: (options: { fileName: string }) =>
    ipcRenderer.invoke('pos:export-report-pdf', options),
  shareReceiptToWhatsApp: (options: { phone: string; receiptNumber: string }) =>
    ipcRenderer.invoke('pos:share-receipt-whatsapp', options),
  getUpdateStatus: () => ipcRenderer.invoke('pos:updates:get-status'),
  checkForUpdates: () => ipcRenderer.invoke('pos:updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('pos:updates:download'),
  installUpdate: () => ipcRenderer.invoke('pos:updates:install'),
  getBackupDirectory: () => ipcRenderer.invoke('pos:backup:get-directory'),
  getBackupConfiguration: () => ipcRenderer.invoke('pos:backup:get-configuration'),
  setBackupConfiguration: (configuration: { mode: 'on-close' | 'manual' | 'scheduled'; scheduledTime: string }) =>
    ipcRenderer.invoke('pos:backup:set-configuration', configuration),
  chooseBackupDirectory: () => ipcRenderer.invoke('pos:backup:choose-directory'),
  createDatabaseBackup: () => ipcRenderer.invoke('pos:backup:create'),
  getGoogleDriveStatus: () => ipcRenderer.invoke('pos:drive:get-status'),
  connectGoogleDrive: (clientId: string) => ipcRenderer.invoke('pos:drive:connect', clientId),
  disconnectGoogleDrive: () => ipcRenderer.invoke('pos:drive:disconnect'),
  resolveCloseRequest: (shouldClose: boolean) =>
    ipcRenderer.invoke('pos:app:resolve-close', shouldClose),
  onCloseRequested: (listener: () => void) => {
    closeRequestListeners.add(listener);
    if (pendingCloseRequest) {
      pendingCloseRequest = false;
      listener();
    }
    return () => closeRequestListeners.delete(listener);
  },
  onLaunchModeRequested: (listener: (mode: 'pos' | 'rpos' | 'erp') => void) => {
    const handler = (_event: Electron.IpcRendererEvent, mode: 'pos' | 'rpos' | 'erp') =>
      listener(mode);
    ipcRenderer.on('pos:app:launch-mode-requested', handler);
    return () => ipcRenderer.removeListener('pos:app:launch-mode-requested', handler);
  },
  openExternal: (url: string) => ipcRenderer.invoke('pos:open-external', url),
  onUpdateStatus: (listener: (status: UpdateStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => listener(status);
    ipcRenderer.on('pos:updates:status', handler);
    return () => ipcRenderer.removeListener('pos:updates:status', handler);
  },
});
