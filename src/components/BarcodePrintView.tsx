import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import {
  Barcode,
  Check,
  Layers,
  Printer,
  Plus,
  Minus,
  Trash2,
  RefreshCw,
  ScanBarcode,
  Search,
  SlidersHorizontal,
  X,
  Zap,
} from 'lucide-react';
import type { Product, ProductMultiUnit, StoreSettings } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { printTemplateJob } from '../printTemplates/render';

interface BarcodePrintViewProps {
  products: Product[];
  settings: StoreSettings;
}

type BarcodeDesignId =
  | 'classic'
  | 'modern-price'
  | 'bilingual'
  | 'compact'
  | 'shelf-tag'
  | 'shelf-price-only'
  | 'food-expiry'
  | 'expiry-box'
  | 'bilingual-dates';

const DATE_DESIGN_IDS: BarcodeDesignId[] = ['food-expiry', 'expiry-box', 'bilingual-dates'];
type BarcodeFormat = 'CODE128' | 'EAN13' | 'CODE39' | 'UPC';
type LabelPresetId =
  | '38x25'
  | '40x30'
  | '50x25'
  | '50x30'
  | '58x40'
  | '70x35'
  | '100x50'
  | 'a4-3x8'
  | 'custom';

interface LabelPreset {
  id: LabelPresetId;
  label: string;
  widthMm: number;
  heightMm: number;
  columns: number;
  gapMm: number;
  isA4Sheet?: boolean;
}

interface QueuedBarcodeItem {
  rowKey: string;
  product: Product;
  productName: string;
  productNameAr: string;
  barcodeValue: string;
  price: number;
  unitId?: string;
  unitName: string;
  unitsPerBase: number;
  copies: number;
  packingDate: string;
  expiryDate: string;
}

interface BarcodePrefs {
  design: BarcodeDesignId;
  barcodeFormat: BarcodeFormat;
  presetId: LabelPresetId;
  customWidthMm: number;
  customHeightMm: number;
  columns: number;
  gapMm: number;
  printerName: string;
  silentPrint: boolean;
  instantPrintOnScan: boolean;
  showStoreName: boolean;
  showPrice: boolean;
  showArabicName: boolean;
  showSku: boolean;
  showBorder: boolean;
  defaultPackingDate: string;
  defaultExpiryDate: string;
}

const PREFS_KEY = 'aptpos_barcode_print_prefs_v1';

const LABEL_PRESETS: LabelPreset[] = [
  { id: '38x25', label: '38 × 25 mm (Small)', widthMm: 38, heightMm: 25, columns: 1, gapMm: 2 },
  { id: '40x30', label: '40 × 30 mm (Retail)', widthMm: 40, heightMm: 30, columns: 1, gapMm: 2 },
  { id: '50x25', label: '50 × 25 mm (Standard)', widthMm: 50, heightMm: 25, columns: 1, gapMm: 2 },
  { id: '50x30', label: '50 × 30 mm (Medium)', widthMm: 50, heightMm: 30, columns: 1, gapMm: 2 },
  { id: '58x40', label: '58 × 40 mm (Large)', widthMm: 58, heightMm: 40, columns: 1, gapMm: 2 },
  { id: '70x35', label: '70 × 35 mm (Shelf Tag)', widthMm: 70, heightMm: 35, columns: 1, gapMm: 2 },
  { id: '100x50', label: '100 × 50 mm (Carton)', widthMm: 100, heightMm: 50, columns: 1, gapMm: 3 },
  { id: 'a4-3x8', label: 'A4 Sheet (3 × 8 · 24/page)', widthMm: 64, heightMm: 34, columns: 3, gapMm: 3, isA4Sheet: true },
  { id: 'custom', label: 'Custom Size (mm)', widthMm: 50, heightMm: 25, columns: 1, gapMm: 2 },
];

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysToIso(iso: string, days: number): string {
  const base = iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date();
  base.setDate(base.getDate() + days);
  return toIsoDate(base);
}

function formatLabelDate(iso?: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const DEFAULT_PREFS: BarcodePrefs = {
  design: 'classic',
  barcodeFormat: 'CODE128',
  presetId: '50x25',
  customWidthMm: 50,
  customHeightMm: 25,
  columns: 1,
  gapMm: 2,
  printerName: '',
  silentPrint: true,
  instantPrintOnScan: false,
  showStoreName: true,
  showPrice: true,
  showArabicName: true,
  showSku: false,
  showBorder: false,
  defaultPackingDate: toIsoDate(new Date()),
  defaultExpiryDate: addDaysToIso(toIsoDate(new Date()), 30),
};

function loadPrefs(): BarcodePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return {
      ...DEFAULT_PREFS,
      ...(JSON.parse(raw) as Partial<BarcodePrefs>),
      instantPrintOnScan: false,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderBarcodeSvgString(
  value: string,
  format: BarcodeFormat,
  heightPx: number
): string {
  const safeValue = (value || '00000000').trim();
  const svgNode = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    JsBarcode(svgNode, safeValue, {
      format,
      width: 1.6,
      height: heightPx,
      displayValue: true,
      fontSize: 11,
      margin: 2,
      background: 'transparent',
      lineColor: '#000000',
    });
  } catch {
    // Fallback to CODE128 if value does not match strict EAN13/UPC digit rules
    JsBarcode(svgNode, safeValue, {
      format: 'CODE128',
      width: 1.6,
      height: heightPx,
      displayValue: true,
      fontSize: 11,
      margin: 2,
      background: 'transparent',
      lineColor: '#000000',
    });
  }
  svgNode.setAttribute('style', 'max-width:100%;height:auto;display:block;margin:0 auto;');
  return new XMLSerializer().serializeToString(svgNode);
}

function buildSingleLabelHtml(
  item: {
    name: string;
    nameAr?: string;
    sku?: string;
    barcode: string;
    price: number;
    category?: string;
    packingDate?: string;
    expiryDate?: string;
  },
  prefs: BarcodePrefs,
  settings: StoreSettings,
  widthMm: number,
  heightMm: number
): string {
  const currency = settings.currencySymbol || 'SAR';
  const decimals = settings.decimalPoints ?? 2;
  const priceText = `${currency} ${Number(item.price || 0).toFixed(decimals)}`;
  const storeName = settings.storeName || 'aptPOS';
  const isDateDesign = DATE_DESIGN_IDS.includes(prefs.design);
  const barcodeHeightPx = Math.max(
    18,
    Math.min(isDateDesign ? 42 : 50, Math.round(heightMm * (isDateDesign ? 0.88 : 1.05)))
  );
  const svgHtml = renderBarcodeSvgString(item.barcode, prefs.barcodeFormat, barcodeHeightPx);
  const borderStyle = prefs.showBorder ? 'border: 0.3mm solid #0f172a;' : '';
  const nameFont = heightMm <= 25 ? '8.5px' : heightMm <= 32 ? '10px' : '11.5px';
  const priceFont = heightMm <= 25 ? '13.5px' : heightMm <= 32 ? '16.5px' : '20px';
  const dateFont = heightMm <= 25 ? '7px' : heightMm <= 32 ? '8px' : '9px';
  const pkdText = formatLabelDate(item.packingDate || prefs.defaultPackingDate);
  const expText = formatLabelDate(item.expiryDate || prefs.defaultExpiryDate);

  if (prefs.design === 'food-expiry') {
    return `
      <div class="label-card" style="width:${widthMm}mm;height:${heightMm}mm;${borderStyle}padding:1mm 1.6mm;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;box-sizing:border-box;background:#fff;">
        ${prefs.showStoreName ? `<div style="font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#475569;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(storeName)}</div>` : ''}
        <div style="text-align:center;">
          <div style="font-size:${nameFont};font-weight:800;color:#0f172a;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.name)}</div>
          ${prefs.showArabicName && item.nameAr ? `<div dir="rtl" style="font-size:8px;color:#334155;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.nameAr)}</div>` : ''}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:1.5mm;background:#f1f5f9;border:0.2mm solid #cbd5e1;border-radius:1mm;padding:0.5mm 1.5mm;font-family:monospace;font-size:${dateFont};font-weight:700;color:#0f172a;">
          <span>PKD: ${escapeHtml(pkdText)}</span>
          <span>EXP: ${escapeHtml(expText)}</span>
        </div>
        <div style="width:100%;overflow:hidden;">${svgHtml}</div>
        ${prefs.showPrice ? `<div style="text-align:center;font-size:${priceFont};font-weight:900;line-height:1.05;font-family:monospace;color:#0f172a;">${escapeHtml(priceText)}</div>` : ''}
      </div>`;
  }

  if (prefs.design === 'expiry-box') {
    return `
      <div class="label-card" style="width:${widthMm}mm;height:${heightMm}mm;border:0.35mm solid #0f172a;padding:1.2mm 1.6mm;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;box-sizing:border-box;background:#fff;border-radius:1mm;">
        <div style="border-bottom:0.2mm solid #cbd5e1;padding-bottom:0.5mm;">
          ${prefs.showStoreName ? `<div style="font-size:6.5px;font-weight:700;text-transform:uppercase;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(storeName)}</div>` : ''}
          <div style="font-size:${nameFont};font-weight:800;color:#0f172a;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.name)}</div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:1.5mm;margin:0.5mm 0;">
          <div style="display:flex;flex-direction:column;gap:0.4mm;font-family:monospace;font-size:${dateFont};font-weight:700;color:#0f172a;border:0.2mm solid #94a3b8;border-radius:0.8mm;padding:0.5mm 1.2mm;background:#f8fafc;">
            <div>PKD: ${escapeHtml(pkdText)}</div>
            <div>EXP: ${escapeHtml(expText)}</div>
          </div>
          ${prefs.showPrice ? `<div style="background:#0f172a;color:#fff;padding:0.8mm 2mm;border-radius:1mm;font-size:${priceFont};font-weight:900;line-height:1.05;font-family:monospace;white-space:nowrap;">${escapeHtml(priceText)}</div>` : ''}
        </div>
        <div style="width:100%;overflow:hidden;">${svgHtml}</div>
      </div>`;
  }

  if (prefs.design === 'bilingual-dates') {
    return `
      <div class="label-card" style="width:${widthMm}mm;height:${heightMm}mm;${borderStyle}padding:1mm 1.6mm;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;box-sizing:border-box;background:#fff;">
        ${prefs.showStoreName ? `<div style="display:flex;justify-content:space-between;font-size:6.5px;font-weight:700;color:#475569;border-bottom:0.2mm solid #e2e8f0;padding-bottom:0.4mm;"><span>${escapeHtml(storeName)}</span>${settings.storeNameAr ? `<span dir="rtl">${escapeHtml(settings.storeNameAr)}</span>` : ''}</div>` : ''}
        <div style="text-align:center;">
          <div style="font-size:${nameFont};font-weight:800;color:#0f172a;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.name)}</div>
          ${item.nameAr ? `<div dir="rtl" style="font-size:${nameFont};font-weight:700;color:#1e293b;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.nameAr)}</div>` : ''}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:1mm;border-top:0.2mm dashed #94a3b8;border-bottom:0.2mm dashed #94a3b8;padding:0.4mm 0.5mm;font-size:${dateFont};font-weight:700;color:#0f172a;">
          <span>PKD/الإنتاج: <span style="font-family:monospace;">${escapeHtml(pkdText)}</span></span>
          <span>EXP/الانتهاء: <span style="font-family:monospace;">${escapeHtml(expText)}</span></span>
        </div>
        <div style="width:100%;overflow:hidden;">${svgHtml}</div>
        ${prefs.showPrice ? `<div style="display:flex;justify-content:space-between;align-items:baseline;font-size:${priceFont};font-weight:900;line-height:1.05;color:#0f172a;font-family:monospace;"><span>${escapeHtml(priceText)}</span><span style="font-size:6.5px;font-family:sans-serif;font-weight:600;color:#475569;">Incl. VAT</span></div>` : ''}
      </div>`;
  }

  if (prefs.design === 'modern-price') {
    return `
      <div class="label-card" style="width:${widthMm}mm;height:${heightMm}mm;${borderStyle}display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;box-sizing:border-box;background:#fff;border-radius:1.5mm;">
        <div style="background:#0f172a;color:#fff;padding:1mm 2mm;display:flex;justify-content:space-between;align-items:center;gap:1mm;">
          <span style="font-size:7.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${prefs.showStoreName ? escapeHtml(storeName) : ''}</span>
          ${prefs.showPrice ? `<span style="font-size:${priceFont};font-weight:900;line-height:1.05;font-family:monospace;white-space:nowrap;">${escapeHtml(priceText)}</span>` : ''}
        </div>
        <div style="padding:0.8mm 1.5mm 1mm;text-align:center;flex:1;display:flex;flex-direction:column;justify-content:space-between;">
          <div style="font-size:${nameFont};font-weight:700;line-height:1.15;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#0f172a;">${escapeHtml(item.name)}</div>
          ${prefs.showArabicName && item.nameAr ? `<div dir="rtl" style="font-size:8px;color:#334155;line-height:1.1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${escapeHtml(item.nameAr)}</div>` : ''}
          <div style="width:100%;overflow:hidden;">${svgHtml}</div>
        </div>
      </div>`;
  }

  if (prefs.design === 'bilingual') {
    return `
      <div class="label-card" style="width:${widthMm}mm;height:${heightMm}mm;${borderStyle}padding:1.2mm 1.8mm;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;box-sizing:border-box;background:#fff;">
        ${prefs.showStoreName ? `<div style="display:flex;justify-content:space-between;font-size:7px;font-weight:700;color:#475569;border-bottom:0.2mm solid #e2e8f0;padding-bottom:0.5mm;"><span>${escapeHtml(storeName)}</span>${settings.storeNameAr ? `<span dir="rtl">${escapeHtml(settings.storeNameAr)}</span>` : ''}</div>` : ''}
        <div style="text-align:center;">
          <div style="font-size:${nameFont};font-weight:700;color:#0f172a;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.name)}</div>
          ${item.nameAr ? `<div dir="rtl" style="font-size:${nameFont};font-weight:700;color:#1e293b;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.nameAr)}</div>` : ''}
        </div>
        <div style="width:100%;overflow:hidden;">${svgHtml}</div>
        ${prefs.showPrice ? `<div style="display:flex;justify-content:space-between;align-items:baseline;font-size:${priceFont};font-weight:900;line-height:1.05;color:#0f172a;font-family:monospace;"><span>${escapeHtml(priceText)}</span><span style="font-size:7px;font-family:sans-serif;font-weight:600;color:#475569;">Incl. VAT</span></div>` : ''}
      </div>`;
  }

  if (prefs.design === 'compact') {
    return `
      <div class="label-card" style="width:${widthMm}mm;height:${heightMm}mm;${borderStyle}padding:1mm 1.2mm;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:0.4mm;overflow:hidden;box-sizing:border-box;background:#fff;text-align:center;">
        <div style="font-size:${nameFont};font-weight:700;color:#0f172a;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.name)}</div>
        <div style="width:100%;overflow:hidden;">${svgHtml}</div>
        ${prefs.showPrice ? `<div style="font-size:${priceFont};font-weight:900;line-height:1.05;font-family:monospace;color:#0f172a;">${escapeHtml(priceText)}</div>` : ''}
      </div>`;
  }

  if (prefs.design === 'shelf-price-only') {
    const heroNameFont = heightMm <= 25 ? '9.5px' : heightMm <= 35 ? '12px' : '14px';
    const heroPriceFont = heightMm <= 25 ? '17px' : heightMm <= 35 ? '23px' : '28px';
    return `
      <div class="label-card" style="width:${widthMm}mm;height:${heightMm}mm;border:0.35mm solid #0f172a;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;box-sizing:border-box;background:#fff;border-radius:1.2mm;">
        <div style="background:#0f172a;color:#fff;padding:1mm 2mm;display:flex;justify-content:space-between;align-items:flex-start;gap:1.5mm;">
          <span style="font-size:${heroNameFont};font-weight:800;line-height:1.15;white-space:normal;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;flex:1;min-width:0;">${escapeHtml(item.name)}</span>
          ${prefs.showStoreName ? `<span style="font-size:7px;font-weight:700;opacity:0.8;white-space:nowrap;flex-shrink:0;">${escapeHtml(storeName)}</span>` : ''}
        </div>
        <div style="flex:1;padding:0.8mm 2mm;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:0.4mm;min-height:0;">
          ${prefs.showArabicName && item.nameAr ? `<div dir="rtl" style="font-size:${Number.parseFloat(heroNameFont) - 1}px;font-weight:700;color:#334155;line-height:1.15;max-width:100%;white-space:normal;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(item.nameAr)}</div>` : ''}
          ${prefs.showPrice ? `<div style="font-size:${heroPriceFont};font-weight:900;line-height:1;font-family:monospace;color:#0f172a;letter-spacing:-0.02em;">${escapeHtml(priceText)}</div>` : ''}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;border-top:0.2mm solid #e2e8f0;background:#f8fafc;padding:0.5mm 2mm;font-size:7px;font-weight:700;color:#475569;">
          <span style="font-family:monospace;">${prefs.showSku && item.sku ? `SKU: ${escapeHtml(item.sku)}` : escapeHtml(item.barcode)}</span>
          <span>Incl. VAT</span>
        </div>
      </div>`;
  }

  if (prefs.design === 'shelf-tag') {
    return `
      <div class="label-card" style="width:${widthMm}mm;height:${heightMm}mm;${borderStyle}padding:1.5mm 2mm;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;box-sizing:border-box;background:#fff;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:2mm;">
          <div style="min-width:0;flex:1;">
            <div style="font-size:${nameFont};font-weight:800;color:#0f172a;line-height:1.15;white-space:normal;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(item.name)}</div>
            ${prefs.showArabicName && item.nameAr ? `<div dir="rtl" style="font-size:8.5px;color:#334155;line-height:1.15;white-space:normal;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(item.nameAr)}</div>` : ''}
            ${prefs.showSku && item.sku ? `<div style="font-size:7px;font-family:monospace;color:#64748b;">SKU: ${escapeHtml(item.sku)}</div>` : ''}
          </div>
          ${prefs.showPrice ? `<div style="background:#0f172a;color:#fff;padding:1mm 2.2mm;border-radius:1mm;font-size:${Number.parseFloat(priceFont) + 3}px;font-weight:900;line-height:1.05;font-family:monospace;white-space:nowrap;flex-shrink:0;">${escapeHtml(priceText)}</div>` : ''}
        </div>
        <div style="width:100%;overflow:hidden;">${svgHtml}</div>
      </div>`;
  }

  // Default: 'classic'
  return `
    <div class="label-card" style="width:${widthMm}mm;height:${heightMm}mm;${borderStyle}padding:1.2mm 1.8mm;display:flex;flex-direction:column;justify-content:space-between;align-items:center;overflow:hidden;box-sizing:border-box;background:#fff;text-align:center;">
      ${prefs.showStoreName ? `<div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#475569;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${escapeHtml(storeName)}</div>` : ''}
      <div style="max-width:100%;">
        <div style="font-size:${nameFont};font-weight:700;color:#0f172a;line-height:1.15;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${escapeHtml(item.name)}</div>
        ${prefs.showArabicName && item.nameAr ? `<div dir="rtl" style="font-size:8px;color:#334155;line-height:1.1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${escapeHtml(item.nameAr)}</div>` : ''}
      </div>
      <div style="width:100%;overflow:hidden;">${svgHtml}</div>
      <div style="display:flex;justify-content:center;align-items:baseline;gap:2mm;width:100%;">
        ${prefs.showSku && item.sku ? `<span style="font-size:7px;font-family:monospace;color:#64748b;">${escapeHtml(item.sku)}</span>` : ''}
        ${prefs.showPrice ? `<span style="font-size:${priceFont};font-weight:900;line-height:1.05;font-family:monospace;color:#0f172a;">${escapeHtml(priceText)}</span>` : ''}
      </div>
    </div>`;
}

export const BarcodePrintView: React.FC<BarcodePrintViewProps> = ({ products, settings }) => {
  const { isRtl } = useLanguage();
  const text = (en: string, ar: string) => (isRtl ? ar : en);

  const [prefs, setPrefs] = useState<BarcodePrefs>(loadPrefs);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [queue, setQueue] = useState<QueuedBarcodeItem[]>([]);
  const [printers, setPrinters] = useState<Array<{ name: string; displayName?: string; isDefault?: boolean }>>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewRowKey, setPreviewRowKey] = useState<string | null>(null);
  const [highlightedSearchIndex, setHighlightedSearchIndex] = useState(0);
  const [unitPickerTarget, setUnitPickerTarget] = useState<{
    rowKey?: string;
    product: Product;
    currentUnitId?: string;
  } | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchItemRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Ignore storage errors
    }
  }, [prefs]);

  const loadPrinters = useCallback(async () => {
    if (!window.electronAPI?.isElectron) return;
    setLoadingPrinters(true);
    try {
      const list = await window.electronAPI.listPrinters();
      setPrinters(Array.isArray(list) ? list : []);
    } catch {
      setPrinters([]);
    } finally {
      setLoadingPrinters(false);
    }
  }, []);

  useEffect(() => {
    void loadPrinters();
    barcodeInputRef.current?.focus();
  }, [loadPrinters]);

  const activePreset = LABEL_PRESETS.find((p) => p.id === prefs.presetId) || LABEL_PRESETS[2];
  const labelWidthMm = prefs.presetId === 'custom' ? Math.max(15, Math.min(210, prefs.customWidthMm || 50)) : activePreset.widthMm;
  const labelHeightMm = prefs.presetId === 'custom' ? Math.max(10, Math.min(297, prefs.customHeightMm || 25)) : activePreset.heightMm;
  const columns = prefs.presetId === 'custom' ? Math.max(1, Math.min(6, prefs.columns || 1)) : activePreset.columns;
  const gapMm = prefs.presetId === 'custom' ? Math.max(0, Math.min(15, prefs.gapMm || 2)) : activePreset.gapMm;
  const isA4Sheet = Boolean(activePreset.isA4Sheet);

  const searchResults = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter(
        (p) =>
          p.barcode?.toLowerCase().includes(q) ||
          p.sku?.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          (p.nameAr && p.nameAr.toLowerCase().includes(q)) ||
          p.additionalBarcodes?.some((b) => b.barcode.toLowerCase().includes(q))
      )
      .slice(0, 10);
  }, [products, searchInput]);

  const printItemsNow = useCallback(
    async (itemsToPrint: QueuedBarcodeItem[], silentOverride?: boolean) => {
      if (itemsToPrint.length === 0) return;
      setPrinting(true);
      setError(null);
      setNotice(null);
      try {
        const expandedLabels: string[] = [];
        for (const entry of itemsToPrint) {
          const copies = Math.max(1, Math.min(500, Math.floor(entry.copies || 1)));
          const html = buildSingleLabelHtml(
            {
              name: entry.productName || entry.product.name,
              nameAr: entry.productNameAr,
              sku: entry.product.sku,
              barcode: entry.barcodeValue || entry.product.barcode || entry.product.sku || String(entry.product.id),
              price: entry.price,
              category: entry.product.category,
              packingDate: entry.packingDate || prefs.defaultPackingDate,
              expiryDate: entry.expiryDate || prefs.defaultExpiryDate,
            },
            prefs,
            settings,
            labelWidthMm,
            labelHeightMm
          );
          for (let i = 0; i < copies; i += 1) {
            expandedLabels.push(html);
          }
        }

        const pageWidthMm = isA4Sheet ? 210 : labelWidthMm * columns + gapMm * Math.max(0, columns - 1);
        const pageHeightMm = isA4Sheet ? 297 : labelHeightMm;

        let bodyContent = '';
        if (isA4Sheet) {
          const perPage = 24;
          const pages: string[] = [];
          for (let i = 0; i < expandedLabels.length; i += perPage) {
            const slice = expandedLabels.slice(i, i + perPage).join('');
            pages.push(
              `<div class="a4-page" style="width:210mm;height:297mm;padding:8mm 6mm;box-sizing:border-box;display:grid;grid-template-columns:repeat(3,${labelWidthMm}mm);grid-auto-rows:${labelHeightMm}mm;gap:${gapMm}mm;justify-content:center;align-content:start;page-break-after:always;">${slice}</div>`
            );
          }
          bodyContent = pages.join('');
        } else {
          const rowsHtml: string[] = [];
          for (let i = 0; i < expandedLabels.length; i += columns) {
            const slice = expandedLabels.slice(i, i + columns).join('');
            rowsHtml.push(
              `<div class="thermal-row" style="width:${pageWidthMm}mm;height:${pageHeightMm}mm;display:flex;gap:${gapMm}mm;align-items:center;justify-content:flex-start;page-break-after:always;overflow:hidden;">${slice}</div>`
            );
          }
          bodyContent = rowsHtml.join('');
        }

        const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Barcode Labels</title>
  <style>
    @page {
      size: ${pageWidthMm}mm ${pageHeightMm}mm;
      margin: 0;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      font-family: 'Segoe UI', Arial, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .thermal-row:last-child, .a4-page:last-child {
      page-break-after: auto;
    }
  </style>
</head>
<body>${bodyContent}</body>
</html>`;

        const printed = await printTemplateJob({
          template: {
            id: `barcode-label-${prefs.design}`,
            documentType: 'sales-invoice',
            format: isA4Sheet ? 'A4' : 'Custom',
            label: `Barcode Label (${prefs.design})`,
            variant: 'classic',
          },
          html: fullHtml,
          silent: silentOverride ?? (Boolean(window.electronAPI?.isElectron) && prefs.silentPrint && Boolean(prefs.printerName)),
          printerName: prefs.printerName || undefined,
          pageSize: {
            width: Math.round(pageWidthMm * 1000),
            height: Math.round(pageHeightMm * 1000),
          },
        });

        setNotice(
          printed
            ? text(`Sent ${expandedLabels.length} barcode label(s) to printer.`, `تم إرسال ${expandedLabels.length} ملصق باركود للطباعة.`)
            : text('Printing was cancelled.', 'تم إلغاء الطباعة.')
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : text('Failed to print barcode labels.', 'تعذرت طباعة ملصقات الباركود.'));
      } finally {
        setPrinting(false);
      }
    },
    [columns, gapMm, isA4Sheet, labelHeightMm, labelWidthMm, prefs, settings]
  );

  const buildQueueEntry = useCallback(
    (product: Product, multiUnit?: ProductMultiUnit | null, customBarcode?: string): QueuedBarcodeItem => {
      const unitId = multiUnit?.id;
      const unitName = multiUnit ? multiUnit.name : product.unit || 'Pcs';
      const unitsPerBase = multiUnit ? multiUnit.unitsPerBase : 1;
      const price = multiUnit
        ? multiUnit.price ?? Number((product.retailPrice * multiUnit.unitsPerBase).toFixed(settings.decimalPoints ?? 2))
        : product.retailPrice;
      const barcodeValue = (
        customBarcode ||
        multiUnit?.barcode ||
        product.barcode ||
        product.sku ||
        String(product.id)
      ).trim();
      const rowKey = `${product.id}:${unitId || 'base'}`;
      return {
        rowKey,
        product,
        productName: product.name,
        productNameAr: product.nameAr || '',
        barcodeValue,
        price,
        unitId,
        unitName,
        unitsPerBase,
        copies: 1,
        packingDate: prefs.defaultPackingDate,
        expiryDate: prefs.defaultExpiryDate,
      };
    },
    [prefs.defaultExpiryDate, prefs.defaultPackingDate, settings.decimalPoints]
  );

  const addProductToQueue = useCallback(
    (
      product: Product,
      customBarcode?: string,
      multiUnit?: ProductMultiUnit | null,
      allowInstantPrint = false,
      focusTarget: 'barcode' | 'search' = 'barcode'
    ) => {
      const newEntry = buildQueueEntry(product, multiUnit, customBarcode);
      setPreviewRowKey(newEntry.rowKey);
      if (allowInstantPrint && prefs.instantPrintOnScan) {
        void printItemsNow([newEntry]);
        setBarcodeInput('');
        setSearchInput('');
        barcodeInputRef.current?.focus();
        return;
      }
      setQueue((current) => {
        const existing = current.find((item) => item.rowKey === newEntry.rowKey);
        if (existing) {
          return current.map((item) =>
            item.rowKey === newEntry.rowKey ? { ...item, copies: item.copies + 1 } : item
          );
        }
        return [newEntry, ...current];
      });
      setBarcodeInput('');
      setSearchInput('');
      if (focusTarget === 'search') {
        searchInputRef.current?.focus();
      } else {
        barcodeInputRef.current?.focus();
      }
    },
    [buildQueueEntry, prefs.instantPrintOnScan, printItemsNow]
  );

  const handleSelectUnitFromPicker = (multiUnit: ProductMultiUnit | null) => {
    if (!unitPickerTarget) return;
    const { rowKey, product } = unitPickerTarget;
    if (rowKey) {
      const updated = buildQueueEntry(product, multiUnit);
      setQueue((current) =>
        current.map((item) =>
          item.rowKey === rowKey
            ? {
                ...item,
                unitId: updated.unitId,
                unitName: updated.unitName,
                unitsPerBase: updated.unitsPerBase,
                barcodeValue: updated.barcodeValue,
                price: updated.price,
              }
            : item
        )
      );
      setPreviewRowKey(rowKey);
    } else {
      addProductToQueue(product, undefined, multiUnit);
    }
    setUnitPickerTarget(null);
  };

  useEffect(() => {
    setHighlightedSearchIndex(0);
  }, [searchInput]);

  useEffect(() => {
    if (searchResults.length === 0) return;
    const clamped = Math.min(highlightedSearchIndex, searchResults.length - 1);
    searchItemRefs.current[clamped]?.scrollIntoView({ block: 'nearest' });
  }, [highlightedSearchIndex, searchResults.length]);

  const handleBarcodeKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const moveNextKey = isRtl ? 'ArrowLeft' : 'ArrowRight';
    if (event.key === moveNextKey) {
      const el = event.currentTarget;
      const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
      if (atEnd || el.value.length === 0) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
    }
    if (event.key === 'Escape' && barcodeInput) {
      event.preventDefault();
      setBarcodeInput('');
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const raw = barcodeInput.trim();
    if (!raw) return;
    const lower = raw.toLowerCase();

    // Check multi-unit barcodes first
    for (const p of products) {
      const matchedUnit = p.multiUnits?.find((u) => u.barcode?.trim().toLowerCase() === lower);
      if (matchedUnit) {
        addProductToQueue(p, matchedUnit.barcode || raw, matchedUnit, true, 'barcode');
        return;
      }
    }

    const exact = products.find(
      (p) =>
        p.barcode?.trim().toLowerCase() === lower ||
        p.sku?.trim().toLowerCase() === lower ||
        p.additionalBarcodes?.some((b) => b.barcode.trim().toLowerCase() === lower)
    );
    if (exact) {
      const addBarcodeMatch = exact.additionalBarcodes?.find(
        (b) => b.barcode.trim().toLowerCase() === lower
      );
      const matchedUnit = addBarcodeMatch?.unitId
        ? exact.multiUnits?.find((u) => u.id === addBarcodeMatch.unitId) || null
        : null;
      addProductToQueue(exact, matchedUnit?.barcode || exact.barcode || raw, matchedUnit, true, 'barcode');
      return;
    }
    setError(text(`No product found for barcode "${raw}".`, `لم يتم العثور على منتج للباركود "${raw}".`));
    setBarcodeInput('');
    barcodeInputRef.current?.focus();
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const movePrevKey = isRtl ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === movePrevKey) {
      const el = event.currentTarget;
      const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
      if (atStart || el.value.length === 0) {
        event.preventDefault();
        barcodeInputRef.current?.focus();
        return;
      }
    }
    if (event.key === 'ArrowDown' && searchResults.length > 0) {
      event.preventDefault();
      setHighlightedSearchIndex((idx) => (idx + 1) % searchResults.length);
      return;
    }
    if (event.key === 'ArrowUp' && searchResults.length > 0) {
      event.preventDefault();
      setHighlightedSearchIndex((idx) => (idx - 1 + searchResults.length) % searchResults.length);
      return;
    }
    if (event.key === 'Escape' && searchInput) {
      event.preventDefault();
      setSearchInput('');
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (searchResults.length > 0) {
      const target =
        searchResults[Math.min(highlightedSearchIndex, searchResults.length - 1)] ||
        searchResults[0];
      addProductToQueue(target, undefined, undefined, false, 'barcode');
      return;
    }
    const raw = searchInput.trim();
    if (raw) {
      setError(text(`No product found matching "${raw}".`, `لم يتم العثور على منتج مطابق لـ "${raw}".`));
    }
  };

  const previewItem = useMemo(() => {
    const queued = queue.find((q) => q.rowKey === previewRowKey) || queue[0];
    if (queued) {
      return {
        rowKey: queued.rowKey,
        name: queued.productName || queued.product.name,
        nameAr: queued.productNameAr,
        sku: queued.product.sku,
        barcode: queued.barcodeValue,
        price: queued.price,
        category: queued.product.category,
        packingDate: queued.packingDate || prefs.defaultPackingDate,
        expiryDate: queued.expiryDate || prefs.defaultExpiryDate,
      };
    }
    const sample = products[0];
    return {
      rowKey: null,
      name: sample?.name || 'Sample Product',
      nameAr: sample?.nameAr || 'منتج تجريبي',
      sku: sample?.sku || 'SKU-001',
      barcode: sample?.barcode || sample?.sku || '6281000000014',
      price: sample?.retailPrice ?? 25,
      category: sample?.category || 'General',
      packingDate: prefs.defaultPackingDate,
      expiryDate: prefs.defaultExpiryDate,
    };
  }, [prefs.defaultExpiryDate, prefs.defaultPackingDate, previewRowKey, products, queue]);

  const livePreviewHtml = useMemo(
    () => buildSingleLabelHtml(previewItem, prefs, settings, labelWidthMm, labelHeightMm),
    [labelHeightMm, labelWidthMm, prefs, previewItem, settings]
  );

  const totalLabelsCount = queue.reduce((sum, item) => sum + Math.max(1, item.copies), 0);
  const isDateDesignActive = DATE_DESIGN_IDS.includes(prefs.design);

  const designs: Array<{ id: BarcodeDesignId; name: string; nameAr: string; desc: string }> = [
    { id: 'classic', name: 'Classic', nameAr: 'كلاسيكي', desc: 'Store + Name + Barcode + Price' },
    { id: 'modern-price', name: 'Modern Price Bar', nameAr: 'شريط سعر عصري', desc: 'Dark header with bold price' },
    { id: 'bilingual', name: 'Bilingual EN/AR', nameAr: 'ثنائي اللغة', desc: 'English & Arabic stacked' },
    { id: 'compact', name: 'Compact Mini', nameAr: 'مضغوط صغير', desc: 'Minimal for small stickers' },
    { id: 'shelf-tag', name: 'Shelf Tag', nameAr: 'بطاقة رف', desc: 'Large price badge for shelves' },
    { id: 'shelf-price-only', name: 'Shelf Tag (No Barcode)', nameAr: 'بطاقة رف (بدون باركود)', desc: 'Extra-large price & name only' },
    { id: 'food-expiry', name: 'Packing & Expiry', nameAr: 'تاريخ التعبئة والانتهاء', desc: 'PKD & EXP strip + Barcode + Price' },
    { id: 'expiry-box', name: 'Expiry & Price Box', nameAr: 'صندوق التاريخ والسعر', desc: 'Boxed PKD/EXP + dark price badge' },
    { id: 'bilingual-dates', name: 'Bilingual EN/AR Dates', nameAr: 'تواريخ ثنائية اللغة', desc: 'EN/AR Name + PKD/EXP dates' },
  ];

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">
      {/* Top Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-blue-700">
            <Barcode className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-base font-bold text-slate-900">
              {text('Barcode Printing', 'طباعة الباركود')}
            </h1>
            <p className="text-[11px] text-slate-500">
              {text(
                'Scan any product to queue or instantly print custom barcode labels.',
                'امسح أي منتج لإضافته أو طباعة ملصق الباركود فوراً.'
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
            <Zap className={`h-3.5 w-3.5 ${prefs.instantPrintOnScan ? 'text-amber-600' : 'text-slate-400'}`} />
            <span>{text('Instant Print on Scan', 'طباعة فورية عند المسح')}</span>
            <input
              type="checkbox"
              checked={prefs.instantPrintOnScan}
              onChange={(e) => setPrefs((cur) => ({ ...cur, instantPrintOnScan: e.target.checked }))}
              className="accent-blue-700"
            />
          </label>
          <button
            type="button"
            disabled={printing || queue.length === 0}
            onClick={() => void printItemsNow(queue)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-blue-800 disabled:opacity-50"
          >
            <Printer className="h-4 w-4" />
            <span>
              {printing
                ? text('Printing...', 'جارٍ الطباعة...')
                : text(`Print ${totalLabelsCount} Label${totalLabelsCount === 1 ? '' : 's'}`, `طباعة ${totalLabelsCount} ملصق`)}
            </span>
          </button>
        </div>
      </div>

      {/* Main Split Workspace */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)] sm:p-5">
        {/* Left: Scan & Print Queue */}
        <div className="flex min-h-0 flex-col gap-4">
          {/* Scanner / Product Search Card (Split Columns) */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {/* Column 1: Barcode Scan (Auto-focused) */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
                    {text('Barcode Scan', 'مسح الباركود')}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">
                    {isRtl ? '←' : '→'} {text('Search', 'بحث')}
                  </span>
                </div>
                <div className="relative">
                  <ScanBarcode className="pointer-events-none absolute start-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-blue-600" />
                  <input
                    ref={barcodeInputRef}
                    type="text"
                    value={barcodeInput}
                    onChange={(e) => {
                      setBarcodeInput(e.target.value);
                      setError(null);
                    }}
                    onKeyDown={handleBarcodeKeyDown}
                    placeholder={text(
                      'Scan barcode & press Enter...',
                      'امسح الباركود واضغط Enter...'
                    )}
                    className="w-full rounded-xl border border-blue-300 bg-blue-50/40 py-2.5 ps-10 pe-3 font-mono text-sm font-semibold text-slate-900 placeholder:font-sans placeholder:font-normal placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </div>

              {/* Column 2: Product Search */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                    {text('Search Product', 'بحث عن منتج')}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">
                    {isRtl ? '→' : '←'} {text('Barcode', 'باركود')} · ↑↓
                  </span>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchInput}
                    onChange={(e) => {
                      setSearchInput(e.target.value);
                      setError(null);
                    }}
                    onKeyDown={handleSearchKeyDown}
                    placeholder={text(
                      'Search product by name / SKU...',
                      'ابحث عن منتج بالاسم / رمز SKU...'
                    )}
                    className="w-full rounded-xl border border-slate-300 bg-slate-50/50 py-2.5 ps-9 pe-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </div>
            </div>

            {searchResults.length > 0 && (
              <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                {searchResults.map((product, index) => {
                  const hasMultiUnits = Boolean(product.multiUnits && product.multiUnits.length > 0);
                  const isHighlighted = index === Math.min(highlightedSearchIndex, searchResults.length - 1);
                  return (
                    <div
                      key={product.id}
                      ref={(el) => {
                        searchItemRefs.current[index] = el;
                      }}
                      role="button"
                      tabIndex={0}
                      onMouseEnter={() => setHighlightedSearchIndex(index)}
                      onClick={() => addProductToQueue(product)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setUnitPickerTarget({ product });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          addProductToQueue(product);
                        }
                      }}
                      title={
                        hasMultiUnits
                          ? text('Click to add · Double-click to choose unit', 'انقر للإضافة · انقر مرتين لاختيار الوحدة')
                          : text('Click to add to print queue', 'انقر للإضافة إلى قائمة الطباعة')
                      }
                      className={`flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-start text-xs transition-colors ${
                        isHighlighted
                          ? 'bg-blue-700 text-white'
                          : 'text-slate-900 hover:bg-blue-50'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`truncate font-semibold ${isHighlighted ? 'text-white' : 'text-slate-900'}`}>
                            {isRtl ? product.nameAr || product.name : product.name}
                          </span>
                          {hasMultiUnits && (
                            <span
                              className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold ${
                                isHighlighted
                                  ? 'bg-white/20 text-white'
                                  : 'bg-violet-100 text-violet-700'
                              }`}
                            >
                              <Layers className="h-2.5 w-2.5" />
                              {(product.multiUnits?.length || 0) + 1} {text('Units', 'وحدات')}
                            </span>
                          )}
                        </div>
                        <div className={`font-mono text-[10px] ${isHighlighted ? 'text-blue-100' : 'text-slate-500'}`}>
                          {product.barcode || product.sku} · {product.unit || 'Pcs'} · {text('Qty', 'الكمية')}: {product.stock}
                        </div>
                      </div>
                      <span className={`shrink-0 font-mono font-bold ${isHighlighted ? 'text-white' : 'text-blue-700'}`}>
                        {settings.currencySymbol || 'SAR'} {product.retailPrice.toFixed(settings.decimalPoints ?? 2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {notice}
              </p>
            )}
          </section>

          {/* Print Queue Table */}
          <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                {text('Print Queue', 'قائمة الطباعة')} ({queue.length} · {totalLabelsCount} {text('labels', 'ملصق')})
              </span>
              {queue.length > 0 && (
                <button
                  type="button"
                  onClick={() => setQueue([])}
                  className="text-xs font-semibold text-red-600 hover:underline"
                >
                  {text('Clear All', 'مسح الكل')}
                </button>
              )}
            </div>

            {queue.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
                <ScanBarcode className="h-10 w-10 text-slate-300" />
                <p className="mt-2 text-sm font-semibold text-slate-700">
                  {text('Scan a product barcode to start', 'امسح باركود منتج للبدء')}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {text(
                    'You can add multiple products and set how many copies to print for each.',
                    'يمكنك إضافة عدة منتجات وتحديد عدد النسخ لكل منتج.'
                  )}
                </p>
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-start text-xs">
                  <thead className="bg-slate-50 text-[10px] font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-start">{text('Product', 'المنتج')}</th>
                      <th className="px-2 py-2 text-start">{text('Barcode', 'الباركود')}</th>
                      <th className="px-2 py-2 text-start">{text('Price', 'السعر')}</th>
                      <th className="px-2 py-2 text-center">{text('Copies', 'النسخ')}</th>
                      <th className="px-2 py-2 text-end">{text('Action', 'إجراء')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {queue.map((entry) => {
                      const hasMultiUnits = Boolean(entry.product.multiUnits && entry.product.multiUnits.length > 0);
                      return (
                        <tr
                          key={entry.rowKey}
                          onClick={() => setPreviewRowKey(entry.rowKey)}
                          onDoubleClick={() =>
                            setUnitPickerTarget({
                              rowKey: entry.rowKey,
                              product: entry.product,
                              currentUnitId: entry.unitId,
                            })
                          }
                          title={text('Double-click row to choose unit', 'انقر مرتين على الصف لاختيار الوحدة')}
                          className={`cursor-pointer transition-colors ${
                            previewItem.rowKey === entry.rowKey ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={entry.productName}
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewRowKey(entry.rowKey);
                              }}
                              onChange={(e) => {
                                const next = e.target.value;
                                setQueue((cur) =>
                                  cur.map((q) =>
                                    q.rowKey === entry.rowKey ? { ...q, productName: next } : q
                                  )
                                );
                              }}
                              className="w-full min-w-[140px] rounded border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-900 focus:border-blue-500 focus:outline-none"
                            />
                            <div className="mt-1 flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setUnitPickerTarget({
                                    rowKey: entry.rowKey,
                                    product: entry.product,
                                    currentUnitId: entry.unitId,
                                  });
                                }}
                                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                                  hasMultiUnits
                                    ? 'bg-violet-50 text-violet-700 hover:bg-violet-100'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                                title={text('Click or double-click row to choose unit', 'انقر أو انقر مرتين لاختيار الوحدة')}
                              >
                                <Layers className="h-2.5 w-2.5" />
                                <span>{entry.unitName}</span>
                                {entry.unitsPerBase > 1 && (
                                  <span className="font-mono text-[9px] opacity-80">
                                    (×{entry.unitsPerBase})
                                  </span>
                                )}
                              </button>
                              <span className="font-mono text-[10px] text-slate-400">
                                {text('Qty', 'الكمية')}:{' '}
                                {entry.unitsPerBase > 1
                                  ? Math.floor(entry.product.stock / entry.unitsPerBase)
                                  : entry.product.stock}
                              </span>
                            </div>
                            {isDateDesignActive && (
                              <div
                                className="mt-1.5 flex flex-wrap items-center gap-1.5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewRowKey(entry.rowKey);
                                }}
                              >
                                <label className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                                  <span>PKD</span>
                                  <input
                                    type="date"
                                    value={entry.packingDate}
                                    onChange={(e) => {
                                      const next = e.target.value;
                                      setQueue((cur) =>
                                        cur.map((q) =>
                                          q.rowKey === entry.rowKey ? { ...q, packingDate: next } : q
                                        )
                                      );
                                    }}
                                    className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-700 focus:border-blue-500 focus:outline-none"
                                  />
                                </label>
                                <label className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                                  <span>EXP</span>
                                  <input
                                    type="date"
                                    value={entry.expiryDate}
                                    onChange={(e) => {
                                      const next = e.target.value;
                                      setQueue((cur) =>
                                        cur.map((q) =>
                                          q.rowKey === entry.rowKey ? { ...q, expiryDate: next } : q
                                        )
                                      );
                                    }}
                                    className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-700 focus:border-blue-500 focus:outline-none"
                                  />
                                </label>
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2 align-top">
                            <input
                              type="text"
                              value={entry.barcodeValue}
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewRowKey(entry.rowKey);
                              }}
                              onChange={(e) => {
                                const next = e.target.value;
                                setQueue((cur) =>
                                  cur.map((q) =>
                                    q.rowKey === entry.rowKey ? { ...q, barcodeValue: next } : q
                                  )
                                );
                              }}
                              className="w-32 rounded border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                            />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <div className="flex items-center gap-1" onClick={(e) => {
                              e.stopPropagation();
                              setPreviewRowKey(entry.rowKey);
                            }}>
                              <span className="font-mono text-[10px] font-semibold text-slate-400">
                                {settings.currencySymbol || 'SAR'}
                              </span>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={entry.price}
                                onChange={(e) => {
                                  const nextPrice = Math.max(0, Number(e.target.value) || 0);
                                  setQueue((cur) =>
                                    cur.map((q) =>
                                      q.rowKey === entry.rowKey ? { ...q, price: nextPrice } : q
                                    )
                                  );
                                }}
                                className="w-24 rounded border border-slate-200 bg-white px-2 py-1 font-mono text-sm font-extrabold text-slate-900 focus:border-blue-500 focus:outline-none"
                              />
                            </div>
                          </td>
                          <td className="px-2 py-2 align-top">
                            <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={() =>
                                  setQueue((cur) =>
                                    cur.map((q) =>
                                      q.rowKey === entry.rowKey
                                        ? { ...q, copies: Math.max(1, q.copies - 1) }
                                        : q
                                    )
                                  )
                                }
                                className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <input
                                type="number"
                                min={1}
                                max={500}
                                value={entry.copies}
                                onChange={(e) => {
                                  const val = Math.max(1, Math.min(500, Number(e.target.value) || 1));
                                  setQueue((cur) =>
                                    cur.map((q) =>
                                      q.rowKey === entry.rowKey ? { ...q, copies: val } : q
                                    )
                                  );
                                }}
                                className="w-12 rounded border border-slate-200 bg-white py-0.5 text-center font-mono text-xs font-bold text-slate-900 focus:border-blue-500 focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setQueue((cur) =>
                                    cur.map((q) =>
                                      q.rowKey === entry.rowKey
                                        ? { ...q, copies: Math.min(500, q.copies + 1) }
                                        : q
                                    )
                                  )
                                }
                                className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                          </td>
                          <td className="px-2 py-2 align-top text-end" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => setQueue((cur) => cur.filter((q) => q.rowKey !== entry.rowKey))}
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              title={text('Remove', 'إزالة')}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* Right: Live Preview + Designs + Sizes + Printer Selection */}
        <div className="flex flex-col gap-4">
          {/* Live Preview */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                {text('Live Label Preview', 'معاينة الملصق')}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
                {labelWidthMm} × {labelHeightMm} mm {columns > 1 ? `· ${columns} cols` : ''}
              </span>
            </div>
            <div className="flex min-h-[150px] items-center justify-center overflow-auto rounded-xl border border-dashed border-slate-300 bg-slate-100/80 p-4">
              <div
                className="shadow-md"
                dangerouslySetInnerHTML={{ __html: livePreviewHtml }}
              />
            </div>
          </section>

          {/* Label Design Selector */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-600">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>{text('Barcode Design & Options', 'تصميم الباركود والخيارات')}</span>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {designs.map((d) => {
                const selected = prefs.design === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setPrefs((cur) => ({ ...cur, design: d.id }))}
                    className={`flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-start transition-colors ${
                      selected
                        ? 'border-blue-600 bg-blue-50/70 ring-1 ring-blue-500'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900">{isRtl ? d.nameAr : d.name}</div>
                      <div className="truncate text-[10px] text-slate-500">{d.desc}</div>
                    </div>
                    {selected && <Check className="h-3.5 w-3.5 shrink-0 text-blue-700" />}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
              <label className="flex cursor-pointer items-center gap-2 text-slate-700">
                <input
                  type="checkbox"
                  checked={prefs.showStoreName}
                  onChange={(e) => setPrefs((c) => ({ ...c, showStoreName: e.target.checked }))}
                  className="accent-blue-700"
                />
                <span>{text('Store Name', 'اسم المتجر')}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-slate-700">
                <input
                  type="checkbox"
                  checked={prefs.showPrice}
                  onChange={(e) => setPrefs((c) => ({ ...c, showPrice: e.target.checked }))}
                  className="accent-blue-700"
                />
                <span>{text('Show Price', 'إظهار السعر')}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-slate-700">
                <input
                  type="checkbox"
                  checked={prefs.showArabicName}
                  onChange={(e) => setPrefs((c) => ({ ...c, showArabicName: e.target.checked }))}
                  className="accent-blue-700"
                />
                <span>{text('Arabic Name', 'الاسم بالعربية')}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-slate-700">
                <input
                  type="checkbox"
                  checked={prefs.showSku}
                  onChange={(e) => setPrefs((c) => ({ ...c, showSku: e.target.checked }))}
                  className="accent-blue-700"
                />
                <span>{text('Show SKU', 'إظهار SKU')}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-slate-700">
                <input
                  type="checkbox"
                  checked={prefs.showBorder}
                  onChange={(e) => setPrefs((c) => ({ ...c, showBorder: e.target.checked }))}
                  className="accent-blue-700"
                />
                <span>{text('Label Border', 'إطار الملصق')}</span>
              </label>
              <label className="flex items-center gap-1.5 text-slate-700">
                <span className="text-[11px] font-medium">{text('Format:', 'النوع:')}</span>
                <select
                  value={prefs.barcodeFormat}
                  onChange={(e) => setPrefs((c) => ({ ...c, barcodeFormat: e.target.value as BarcodeFormat }))}
                  className="flex-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-mono"
                >
                  <option value="CODE128">CODE128</option>
                  <option value="EAN13">EAN-13</option>
                  <option value="CODE39">CODE39</option>
                  <option value="UPC">UPC</option>
                </select>
              </label>
            </div>

            {isDateDesignActive && (
              <div className="space-y-2 rounded-lg border border-blue-100 bg-blue-50/40 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-700">
                    {text('Packing & Expiry Dates', 'تاريخ التعبئة والانتهاء')}
                  </span>
                  <div className="flex items-center gap-1">
                    {[
                      { label: '+7d', days: 7 },
                      { label: '+30d', days: 30 },
                      { label: '+6m', days: 180 },
                      { label: '+1y', days: 365 },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          const nextExp = addDaysToIso(prefs.defaultPackingDate, preset.days);
                          setPrefs((c) => ({ ...c, defaultExpiryDate: nextExp }));
                          setQueue((cur) => cur.map((q) => ({ ...q, expiryDate: nextExp })));
                        }}
                        className="rounded border border-blue-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold text-blue-700 hover:bg-blue-600 hover:text-white"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold text-slate-600">
                      {text('Packing Date (PKD)', 'تاريخ التعبئة (PKD)')}
                    </span>
                    <input
                      type="date"
                      value={prefs.defaultPackingDate}
                      onChange={(e) => {
                        const next = e.target.value;
                        setPrefs((c) => ({ ...c, defaultPackingDate: next }));
                        setQueue((cur) => cur.map((q) => ({ ...q, packingDate: next })));
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-800"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold text-slate-600">
                      {text('Expiry Date (EXP)', 'تاريخ الانتهاء (EXP)')}
                    </span>
                    <input
                      type="date"
                      value={prefs.defaultExpiryDate}
                      onChange={(e) => {
                        const next = e.target.value;
                        setPrefs((c) => ({ ...c, defaultExpiryDate: next }));
                        setQueue((cur) => cur.map((q) => ({ ...q, expiryDate: next })));
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-800"
                    />
                  </label>
                </div>
              </div>
            )}
          </section>

          {/* Label Size & Custom Size */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-600">
              {text('Label Size & Custom Dimensions', 'حجم الملصق والأبعاد المخصصة')}
            </div>
            <select
              value={prefs.presetId}
              onChange={(e) => {
                const nextId = e.target.value as LabelPresetId;
                const preset = LABEL_PRESETS.find((p) => p.id === nextId);
                setPrefs((cur) => ({
                  ...cur,
                  presetId: nextId,
                  ...(preset && nextId !== 'custom'
                    ? {
                        customWidthMm: preset.widthMm,
                        customHeightMm: preset.heightMm,
                        columns: preset.columns,
                        gapMm: preset.gapMm,
                      }
                    : {}),
                }));
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800"
            >
              {LABEL_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>

            {prefs.presetId === 'custom' && (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold text-slate-500">
                    {text('Width (mm)', 'العرض (مم)')}
                  </span>
                  <input
                    type="number"
                    min={15}
                    max={210}
                    value={prefs.customWidthMm}
                    onChange={(e) => setPrefs((c) => ({ ...c, customWidthMm: Number(e.target.value) || 50 }))}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold text-slate-500">
                    {text('Height (mm)', 'الارتفاع (مم)')}
                  </span>
                  <input
                    type="number"
                    min={10}
                    max={297}
                    value={prefs.customHeightMm}
                    onChange={(e) => setPrefs((c) => ({ ...c, customHeightMm: Number(e.target.value) || 25 }))}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold text-slate-500">
                    {text('Columns', 'الأعمدة')}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={prefs.columns}
                    onChange={(e) => setPrefs((c) => ({ ...c, columns: Math.max(1, Math.min(6, Number(e.target.value) || 1)) }))}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold text-slate-500">
                    {text('Gap (mm)', 'المسافة (مم)')}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={15}
                    value={prefs.gapMm}
                    onChange={(e) => setPrefs((c) => ({ ...c, gapMm: Math.max(0, Math.min(15, Number(e.target.value) || 0)) }))}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs"
                  />
                </label>
              </div>
            )}
          </section>

          {/* Barcode Printer Selection */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                {text('Barcode Printer', 'طابعة الباركود')}
              </span>
              {window.electronAPI?.isElectron && (
                <button
                  type="button"
                  disabled={loadingPrinters}
                  onClick={() => void loadPrinters()}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:underline"
                >
                  <RefreshCw className={`h-3 w-3 ${loadingPrinters ? 'animate-spin' : ''}`} />
                  {text('Refresh', 'تحديث')}
                </button>
              )}
            </div>

            {window.electronAPI?.isElectron ? (
              <>
                <select
                  value={prefs.printerName}
                  onChange={(e) => setPrefs((c) => ({ ...c, printerName: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800"
                >
                  <option value="">{text('System Default Printer (Ask Dialog)', 'الطابعة الافتراضية للنظام')}</option>
                  {printers.map((printer) => (
                    <option key={printer.name} value={printer.name}>
                      {printer.displayName || printer.name}
                      {printer.isDefault ? ' ★' : ''}
                    </option>
                  ))}
                </select>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={prefs.silentPrint}
                    onChange={(e) => setPrefs((c) => ({ ...c, silentPrint: e.target.checked }))}
                    className="accent-blue-700"
                  />
                  <span>{text('Direct Silent Print (skip print dialog)', 'طباعة مباشرة بدون نافذة الطباعة')}</span>
                </label>
              </>
            ) : (
              <p className="text-[11px] text-slate-500">
                {text(
                  'Browser mode uses the system print dialog. In the aptPOS Desktop app, select your dedicated thermal barcode printer directly here.',
                  'في وضع المتصفح يتم استخدام نافذة الطباعة للنظام. في تطبيق سطح المكتب aptPOS يمكنك اختيار طابعة الباركود الحرارية مباشرة هنا.'
                )}
              </p>
            )}
          </section>
        </div>
      </div>

      {/* Multi-Unit Picker Modal */}
      {unitPickerTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
          onClick={() => setUnitPickerTarget(null)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  {text('Select Product Unit', 'اختر وحدة المنتج')}
                </h2>
                <p className="text-xs text-slate-500">
                  {isRtl
                    ? unitPickerTarget.product.nameAr || unitPickerTarget.product.name
                    : unitPickerTarget.product.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setUnitPickerTarget(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto p-2">
              {/* Base Unit */}
              <button
                type="button"
                onClick={() => handleSelectUnitFromPicker(null)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-start transition-colors ${
                  !unitPickerTarget.currentUnitId
                    ? 'bg-blue-50 ring-1 ring-blue-300'
                    : 'hover:bg-slate-50'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">
                      {unitPickerTarget.product.unit || 'Pcs'}
                    </span>
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-700">
                      {text('Base Unit', 'الوحدة الأساسية')}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                    {text('Qty', 'الكمية')}: 1 × {unitPickerTarget.product.unit || 'Pcs'} ·{' '}
                    {text('Stock', 'المخزون')}: {unitPickerTarget.product.stock}{' '}
                    {unitPickerTarget.product.unit || 'Pcs'}
                  </div>
                  <div className="font-mono text-[10px] text-slate-400">
                    {text('Barcode', 'الباركود')}:{' '}
                    {unitPickerTarget.product.barcode || unitPickerTarget.product.sku}
                  </div>
                </div>
                <div className="shrink-0 text-end">
                  <div className="font-mono text-sm font-extrabold text-blue-700">
                    {settings.currencySymbol || 'SAR'}{' '}
                    {unitPickerTarget.product.retailPrice.toFixed(settings.decimalPoints ?? 2)}
                  </div>
                  {!unitPickerTarget.currentUnitId && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-600">
                      <Check className="h-3 w-3" /> {text('Selected', 'محدد')}
                    </span>
                  )}
                </div>
              </button>

              {/* Multi Units */}
              {(unitPickerTarget.product.multiUnits || []).map((unit) => {
                const unitPrice =
                  unit.price ??
                  Number(
                    (unitPickerTarget.product.retailPrice * unit.unitsPerBase).toFixed(
                      settings.decimalPoints ?? 2
                    )
                  );
                const availableUnitQty =
                  unit.unitsPerBase > 0
                    ? Math.floor(unitPickerTarget.product.stock / unit.unitsPerBase)
                    : 0;
                const isSelected = unitPickerTarget.currentUnitId === unit.id;
                return (
                  <button
                    key={unit.id}
                    type="button"
                    onClick={() => handleSelectUnitFromPicker(unit)}
                    className={`mt-1 flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-start transition-colors ${
                      isSelected ? 'bg-blue-50 ring-1 ring-blue-300' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">{unit.name}</span>
                        <span className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-[9px] font-bold text-violet-700">
                          1 {unit.name} = {unit.unitsPerBase}{' '}
                          {unitPickerTarget.product.unit || 'Pcs'}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                        {text('Stock', 'المخزون')}: {availableUnitQty} {unit.name} (
                        {unitPickerTarget.product.stock} {unitPickerTarget.product.unit || 'Pcs'})
                      </div>
                      <div className="font-mono text-[10px] text-slate-400">
                        {text('Barcode', 'الباركود')}:{' '}
                        {unit.barcode || unitPickerTarget.product.barcode || unitPickerTarget.product.sku}
                      </div>
                    </div>
                    <div className="shrink-0 text-end">
                      <div className="font-mono text-sm font-extrabold text-blue-700">
                        {settings.currencySymbol || 'SAR'}{' '}
                        {unitPrice.toFixed(settings.decimalPoints ?? 2)}
                      </div>
                      {isSelected && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-600">
                          <Check className="h-3 w-3" /> {text('Selected', 'محدد')}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}

              {(!unitPickerTarget.product.multiUnits ||
                unitPickerTarget.product.multiUnits.length === 0) && (
                <p className="px-3 py-3 text-center text-[11px] text-slate-400">
                  {text(
                    'No additional multi-units configured for this product in Inventory.',
                    'لا توجد وحدات إضافية مضافة لهذا المنتج في المخزون.'
                  )}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
