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
        html?: string;
      }) => Promise<{ ok: boolean; error?: string }>;
      exportPdf: (options: { fileName: string }) => Promise<{ canceled: boolean; filePath?: string }>;
      shareReceiptToWhatsApp: (options: { phone: string; receiptNumber: string }) =>
        Promise<{ canceled: boolean; filePath?: string }>;
      getUpdateStatus: () => Promise<UpdateStatus>;
      checkForUpdates: () => Promise<UpdateStatus>;
      downloadUpdate: () => Promise<UpdateStatus>;
      installUpdate: () => Promise<void>;
      getBackupDirectory: () => Promise<string>;
      getBackupConfiguration: () => Promise<{
        directory: string;
        mode: 'on-close' | 'manual' | 'scheduled';
        scheduledTime: string;
      }>;
      setBackupConfiguration: (configuration: {
        mode: 'on-close' | 'manual' | 'scheduled';
        scheduledTime: string;
      }) => Promise<{
        directory: string;
        mode: 'on-close' | 'manual' | 'scheduled';
        scheduledTime: string;
      }>;
      chooseBackupDirectory: () => Promise<string | null>;
      createDatabaseBackup: () => Promise<{ filePath: string; googleDriveUploaded: boolean }>;
      getGoogleDriveStatus: () => Promise<{ clientId: string; connected: boolean }>;
      connectGoogleDrive: (clientId: string) => Promise<{ clientId: string; connected: boolean }>;
      disconnectGoogleDrive: () => Promise<{ clientId: string; connected: boolean }>;
      resolveCloseRequest: (shouldClose: boolean) => Promise<boolean>;
      onCloseRequested: (listener: () => void) => () => void;
      onUpdateStatus: (listener: (status: UpdateStatus) => void) => () => void;
    };
  }
}

export {};
