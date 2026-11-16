import type { UpdateStatus } from '../../electron/updateStatus';

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      chooseProductImage: () => Promise<string | null>;
      readProductImage: (imagePath: string) => Promise<string>;
      listPrinters: () => Promise<Array<{ name: string; displayName: string }>>;
      printReceipt: (options?: {
        silent?: boolean;
        printerName?: string;
        pageSize?: { width: number; height: number };
      }) => Promise<{ ok: boolean; error?: string }>;
      exportPdf: (options: { fileName: string }) => Promise<{ canceled: boolean; filePath?: string }>;
      shareReceiptToWhatsApp: (options: { phone: string; receiptNumber: string }) =>
        Promise<{ canceled: boolean; filePath?: string }>;
      getUpdateStatus: () => Promise<UpdateStatus>;
      checkForUpdates: () => Promise<UpdateStatus>;
      installUpdate: () => Promise<void>;
      onUpdateStatus: (listener: (status: UpdateStatus) => void) => () => void;
    };
  }
}

export {};
