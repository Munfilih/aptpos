import { contextBridge, ipcRenderer } from 'electron';
import type { UpdateStatus } from './updateStatus.js' with { 'resolution-mode': 'import' };

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  chooseProductImage: () => ipcRenderer.invoke('pos:choose-product-image'),
  readProductImage: (imagePath: string) => ipcRenderer.invoke('pos:read-product-image', imagePath),
  listPrinters: () => ipcRenderer.invoke('pos:list-printers'),
  printReceipt: (options?: {
    silent?: boolean;
    printerName?: string;
    pageSize?: { width: number; height: number };
  }) =>
    ipcRenderer.invoke('pos:print-receipt', options || {}),
  exportPdf: (options: { fileName: string }) =>
    ipcRenderer.invoke('pos:export-report-pdf', options),
  shareReceiptToWhatsApp: (options: { phone: string; receiptNumber: string }) =>
    ipcRenderer.invoke('pos:share-receipt-whatsapp', options),
  getUpdateStatus: () => ipcRenderer.invoke('pos:updates:get-status'),
  checkForUpdates: () => ipcRenderer.invoke('pos:updates:check'),
  installUpdate: () => ipcRenderer.invoke('pos:updates:install'),
  onUpdateStatus: (listener: (status: UpdateStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => listener(status);
    ipcRenderer.on('pos:updates:status', handler);
    return () => ipcRenderer.removeListener('pos:updates:status', handler);
  },
});
