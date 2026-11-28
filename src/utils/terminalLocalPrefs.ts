import type { PaperWidth, PrintDocumentProfile, PrintDocumentType, StoreSettings } from '../types/pos';

const LOCAL_PRINTER_PREFS_KEY = 'aptpos_terminal_local_printers_v1';

export interface LocalTerminalPrinterPrefs {
  defaultPrinter?: string;
  kotPrinter?: string;
  paperWidth?: PaperWidth;
  autoPrintReceiptOnSale?: boolean;
  defaultReceiptAction?: 'print' | 'done';
  printerOnline?: boolean;
  printDocumentFormats?: Partial<Record<PrintDocumentType, PaperWidth>>;
  printDocumentPrinters?: Partial<
    Record<PrintDocumentType, Partial<Record<PaperWidth, Pick<PrintDocumentProfile, 'printerName' | 'printerMode'>>>>
  >;
}

export function loadLocalTerminalPrinterPrefs(): LocalTerminalPrinterPrefs | null {
  try {
    const raw = localStorage.getItem(LOCAL_PRINTER_PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as LocalTerminalPrinterPrefs) : null;
  } catch {
    return null;
  }
}

export function saveLocalTerminalPrinterPrefsFromSettings(settings: StoreSettings): void {
  try {
    const printDocumentPrinters: LocalTerminalPrinterPrefs['printDocumentPrinters'] = {};
    if (settings.printDocumentProfiles) {
      for (const [docType, widths] of Object.entries(settings.printDocumentProfiles)) {
        if (!widths) continue;
        const perWidth: Partial<
          Record<PaperWidth, Pick<PrintDocumentProfile, 'printerName' | 'printerMode'>>
        > = {};
        for (const [width, profile] of Object.entries(widths)) {
          if (!profile) continue;
          if (profile.printerName !== undefined || profile.printerMode !== undefined) {
            perWidth[width as PaperWidth] = {
              ...(profile.printerName !== undefined ? { printerName: profile.printerName } : {}),
              ...(profile.printerMode !== undefined ? { printerMode: profile.printerMode } : {}),
            };
          }
        }
        if (Object.keys(perWidth).length > 0) {
          printDocumentPrinters[docType as PrintDocumentType] = perWidth;
        }
      }
    }

    const prefs: LocalTerminalPrinterPrefs = {
      defaultPrinter: settings.defaultPrinter,
      kotPrinter: settings.kotPrinter,
      paperWidth: settings.paperWidth,
      autoPrintReceiptOnSale: settings.autoPrintReceiptOnSale,
      defaultReceiptAction: settings.defaultReceiptAction,
      printerOnline: settings.printerOnline,
      printDocumentFormats: settings.printDocumentFormats,
      printDocumentPrinters,
    };
    localStorage.setItem(LOCAL_PRINTER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore localStorage quota/privacy errors
  }
}

/**
 * Merges this PC's locally saved printer preferences onto the shared store
 * settings returned by the Primary Server, so Counter 1 and Counter 2 keep
 * independent thermal/A4/KOT printers while sharing all store/tax/inventory data.
 */
export function applyLocalTerminalPrinterOverrides(
  serverSettings: StoreSettings,
  isClientTerminal: boolean
): StoreSettings {
  if (!isClientTerminal) return serverSettings;
  const local = loadLocalTerminalPrinterPrefs();
  if (!local) return serverSettings;

  const mergedProfiles = serverSettings.printDocumentProfiles
    ? { ...serverSettings.printDocumentProfiles }
    : {};

  if (local.printDocumentPrinters) {
    for (const [docType, widths] of Object.entries(local.printDocumentPrinters)) {
      if (!widths) continue;
      const dt = docType as PrintDocumentType;
      const existingWidths = { ...(mergedProfiles[dt] || {}) };
      for (const [width, overrides] of Object.entries(widths)) {
        if (!overrides) continue;
        const pw = width as PaperWidth;
        if (existingWidths[pw]) {
          existingWidths[pw] = {
            ...existingWidths[pw]!,
            ...overrides,
          };
        }
      }
      mergedProfiles[dt] = existingWidths;
    }
  }

  return {
    ...serverSettings,
    ...(local.defaultPrinter !== undefined ? { defaultPrinter: local.defaultPrinter } : {}),
    ...(local.kotPrinter !== undefined ? { kotPrinter: local.kotPrinter } : {}),
    ...(local.paperWidth !== undefined ? { paperWidth: local.paperWidth } : {}),
    ...(local.autoPrintReceiptOnSale !== undefined
      ? { autoPrintReceiptOnSale: local.autoPrintReceiptOnSale }
      : {}),
    ...(local.defaultReceiptAction !== undefined
      ? { defaultReceiptAction: local.defaultReceiptAction }
      : {}),
    ...(local.printerOnline !== undefined ? { printerOnline: local.printerOnline } : {}),
    ...(local.printDocumentFormats
      ? { printDocumentFormats: { ...serverSettings.printDocumentFormats, ...local.printDocumentFormats } }
      : {}),
    ...(Object.keys(mergedProfiles).length > 0 ? { printDocumentProfiles: mergedProfiles } : {}),
  };
}
