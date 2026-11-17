import React, { useEffect, useRef, useState } from 'react';
import { Printer, X, Check, FileText, QrCode, Banknote, CreditCard, Receipt } from 'lucide-react';
import QRCode from 'qrcode';
import type { PaperWidth, Sale, SalesReturnVoucher, StoreSettings } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { generateZatcaTlvBase64 } from '../utils/zatcaQr';
import {
  applyThermalPageSize,
  measureThermalPageSize,
  printWithThermalPageSize,
  resolveInvoiceMarginsMm,
} from '../utils/thermalPrinting';

const A4_ITEMS_PER_PAGE = 13;

interface ThermalReceiptModalProps {
  sale: Sale;
  returnVouchers: SalesReturnVoucher[];
  settings: StoreSettings;
  queuedOffline?: boolean;
  onClose: () => void;
}

export const ThermalReceiptModal: React.FC<ThermalReceiptModalProps> = ({
  sale,
  returnVouchers,
  settings,
  queuedOffline,
  onClose,
}) => {
  const { language } = useLanguage();
  const activeFormat: PaperWidth = settings.paperWidth || '80mm';
  const templateSettings = settings.invoiceTemplates?.[activeFormat];

  const [zatcaQrDataUrl, setZatcaQrDataUrl] = useState<string>('');
  const [printError, setPrintError] = useState<string | null>(null);
  const [previewBeforePrint, setPreviewBeforePrint] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);

  // Generate the electronic invoice QR code payload.
  useEffect(() => {
    let isMounted = true;
    const seller = settings.storeNameAr || settings.storeName || 'aptPOS Retail';
    const vat = settings.taxId || '300000000000003';
    const total = sale.total;
    const tax = sale.taxAmount;
    const time = sale.createdAt;

    try {
      const tlvPayload = generateZatcaTlvBase64({
        sellerName: seller,
        vatNumber: vat,
        timestamp: time,
        totalAmount: total,
        taxAmount: tax,
      });

      QRCode.toDataURL(tlvPayload, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 256,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      }).then((url) => {
        if (isMounted) {
          setZatcaQrDataUrl(url);
        }
      }).catch(console.error);
    } catch (e) {
      console.error('Failed to generate invoice QR code:', e);
    }

    return () => {
      isMounted = false;
    };
  }, [sale, settings]);

  const primaryActionBtnRef = useRef<HTMLButtonElement>(null);

  const c = settings.currencySymbol || 'SAR';
  const formattedDate = new Date(sale.createdAt).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const handlePrint = async () => {
    setPrintError(null);
    try {
      const isElectron = window.electronAPI?.isElectron === true;
      const thermalWidthMm = activeFormat === '58mm' ? 58 : 80;
      const pageSize = activeFormat === 'A4'
        ? { width: 210_000, height: 297_000 }
        : measureThermalPageSize(
            document.querySelector<HTMLElement>('.thermal-receipt-print-area:not(.paper-a4)'),
            {
              elementWidthMm: thermalWidthMm,
              pageWidthMm: thermalWidthMm,
              padding: `${invoiceMarginsMm.top}mm ${invoiceMarginsMm.right}mm ${invoiceMarginsMm.bottom}mm ${invoiceMarginsMm.left}mm`,
              container: document.querySelector('.receipt-print-source'),
            }
          );
      if (window.electronAPI?.isElectron) {
        const printerMode = templateSettings?.printerMode
          || (templateSettings?.defaultPrinter ? 'saved-printer' : 'system-default');
        const removePageStyle = pageSize ? applyThermalPageSize(pageSize) : undefined;
        try {
          const result = await window.electronAPI.printReceipt({
            silent: printerMode !== 'choose-at-print-time',
            printerName: printerMode === 'saved-printer' ? templateSettings?.defaultPrinter || undefined : undefined,
            ...(pageSize ? { pageSize } : {}),
          });
          if (!result.ok) {
            if (result.error?.toLowerCase() === 'cancelled' || result.error?.toLowerCase() === 'canceled') {
              return false;
            }
            throw new Error(result.error || 'Receipt could not be printed.');
          }
        } finally {
          removePageStyle?.();
        }
      } else {
        if (activeFormat !== 'A4' && pageSize) printWithThermalPageSize(pageSize);
        else window.print();
      }
      return true;
    } catch (error) {
      console.error('Failed to print receipt:', error);
      setPrintError((error as Error).message || 'Receipt could not be printed.');
      return false;
    }
  };

  const handlePrintAndClose = async () => {
    if (previewBeforePrint && !showPrintPreview) {
      setPrintError(null);
      setShowPrintPreview(true);
      return;
    }
    if (await handlePrint()) onClose();
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      primaryActionBtnRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F12') {
        e.preventDefault();
        void handlePrintAndClose();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (showPrintPreview) {
          void handlePrintAndClose();
          return;
        }
        onClose();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (showPrintPreview) {
          setShowPrintPreview(false);
          return;
        }
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose, handlePrintAndClose, showPrintPreview]);

  const isInclusive = (sale.taxType || settings.taxType) === 'inclusive';

  // Visibility settings helpers with defaults
  const showNameEn = (templateSettings?.invoiceShowProductName ?? settings.invoiceShowProductName) !== false;
  const showNameAr = (templateSettings?.invoiceShowProductNameAr ?? settings.invoiceShowProductNameAr) !== false;
  const showBarcode = (templateSettings?.invoiceShowBarcode ?? settings.invoiceShowBarcode) === true;
  const showCustomer = (templateSettings?.invoiceShowCustomerInfo ?? settings.invoiceShowCustomerInfo) !== false;
  const showCashier = (templateSettings?.invoiceShowCashierName ?? settings.invoiceShowCashierName) !== false;
  const showTax = (templateSettings?.invoiceShowTaxDetails ?? settings.invoiceShowTaxDetails) !== false;
  const showAddress = (templateSettings?.invoiceShowStoreAddress ?? settings.invoiceShowStoreAddress) !== false;
  const showFooter = (templateSettings?.invoiceShowFooter ?? settings.invoiceShowFooter) !== false;
  const showQr = (templateSettings?.invoiceShowQrCode ?? settings.invoiceShowQrCode) !== false;
  const invoiceMarginsMm = resolveInvoiceMarginsMm(activeFormat, templateSettings?.invoiceMarginsMm);
  const a4ItemPages = Array.from(
    { length: Math.max(1, Math.ceil(sale.items.length / A4_ITEMS_PER_PAGE)) },
    (_, pageIndex) => sale.items.slice(
      pageIndex * A4_ITEMS_PER_PAGE,
      (pageIndex + 1) * A4_ITEMS_PER_PAGE
    )
  );

  const subtotalExcl = (isInclusive && Math.abs(sale.subtotal - sale.total) < 0.05 && sale.taxAmount > 0)
    ? (sale.total - sale.taxAmount)
    : sale.subtotal;

  const returnDetails = returnVouchers
    .map((voucher) => {
      const items = voucher.items.filter((item) => item.saleId === sale.id);
      return {
        voucher,
        items,
        refundAmount: items.reduce((sum, item) => sum + item.refundAmount, 0),
      };
    })
    .filter((detail) => detail.items.length > 0)
    .sort((a, b) => a.voucher.createdAt.localeCompare(b.voucher.createdAt));
  const linkedRefundTotal = returnDetails.reduce((sum, detail) => sum + detail.refundAmount, 0);
  const totalRefunded = sale.returnedTotal ?? linkedRefundTotal;
  const taxRefunded = sale.returnedTaxAmount ?? 0;
  const netAfterReturns = Math.max(0, sale.total - totalRefunded);
  const netTaxAfterReturns = Math.max(0, sale.taxAmount - taxRefunded);
  const formatReturnDate = (date: string) =>
    new Date(date).toLocaleString(language === 'ar' ? 'ar-SA' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div
      className="invoice-print-modal fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tender-modal-title"
    >
      <div className={`invoice-print-dialog bg-white border border-slate-200 rounded-2xl w-full max-w-lg max-h-[92vh] overflow-hidden shadow-2xl flex flex-col${showPrintPreview ? ' receipt-preview-open' : ''}`}>
        <div className="no-print px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3 shrink-0 bg-white">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <Check className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 id="tender-modal-title" className="text-base font-bold text-slate-900">
                {language === 'ar' ? 'تم إتمام البيع' : 'Sale Complete'}
              </h2>
              <p className="text-xs text-slate-500">
                {language === 'ar' ? 'تم تسجيل عملية الدفع بنجاح' : 'Payment has been recorded successfully'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label={language === 'ar' ? 'إغلاق' : 'Close'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {queuedOffline && (
          <div className="no-print px-5 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-900 font-medium">
            Receipt saved to the offline print queue. You can print it later from Settings.
          </div>
        )}

        <div className="no-print flex-1 overflow-y-auto p-5 space-y-4">
          <div className="rounded-xl bg-slate-950 text-white p-5 text-center">
            <div className="text-xs font-medium text-slate-300">
              {language === 'ar' ? 'المبلغ الإجمالي' : 'TOTAL DUE'}
            </div>
            <div className="mt-1 text-3xl font-bold tabular-nums">
              {c} {sale.total.toFixed(settings.decimalPoints ?? 2)}
            </div>
            <div className="mt-2 text-xs text-slate-300">
              {sale.receiptNumber} · {formattedDate}
              {sale.kotNumber && ` · KOT: ${sale.kotNumber}`}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
            <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <span className="flex items-center gap-2 text-slate-600">
                {sale.paymentMethod === 'Cash'
                  ? <Banknote className="h-4 w-4 text-slate-400" />
                  : <CreditCard className="h-4 w-4 text-slate-400" />}
                {language === 'ar' ? 'طريقة الدفع' : 'Payment method'}
              </span>
              <span className="font-semibold text-slate-900">{sale.paymentMethod}</span>
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <span className="text-slate-600">{language === 'ar' ? 'المبلغ المستلم' : 'Amount received'}</span>
              <span className="font-semibold font-mono tabular-nums text-slate-900">
                {c} {sale.amountTendered.toFixed(settings.decimalPoints ?? 2)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <span className="font-semibold text-slate-900">{language === 'ar' ? 'الباقي' : 'Change due'}</span>
              <span className="font-bold font-mono tabular-nums text-emerald-700">
                {c} {sale.changeDue.toFixed(settings.decimalPoints ?? 2)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3 text-xs">
              <span className="text-slate-500">{language === 'ar' ? 'العميل' : 'Customer'}</span>
              <span className="font-medium text-slate-700 text-right">{sale.customerName}</span>
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3 text-xs">
              <span className="flex items-center gap-2 text-slate-500">
                <Receipt className="h-4 w-4 text-slate-400" />
                {language === 'ar' ? 'الأصناف' : 'Items'}
              </span>
              <span className="font-medium text-slate-700">
                {sale.items.reduce((count, item) => count + item.quantity, 0)}
              </span>
            </div>
          </div>

          {returnDetails.length > 0 && (
            <section className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 space-y-3">
              <h3 className="text-sm font-bold text-violet-950">
                {language === 'ar' ? 'مرتجعات مرتبطة بهذه الفاتورة' : 'Returns linked to this invoice'}
              </h3>
              {returnDetails.map(({ voucher, items, refundAmount }) => (
                <div key={voucher.id} className="border-t border-violet-200 pt-2 text-xs">
                  <div className="flex flex-wrap justify-between gap-1 font-semibold text-slate-800">
                    <span>{voucher.voucherNumber}</span>
                    <span className="text-slate-500">{formatReturnDate(voucher.createdAt)}</span>
                  </div>
                  {items.map((item) => (
                    <div key={`${voucher.id}-${item.saleItemId}`} className="mt-1 flex justify-between gap-3 text-slate-600">
                      <span className="min-w-0 truncate">
                        {item.productName} × {item.quantity}{item.unitName ? ` ${item.unitName}` : ''}
                      </span>
                      <span className="shrink-0 font-mono">{c} {item.refundAmount.toFixed(settings.decimalPoints ?? 2)}</span>
                    </div>
                  ))}
                  <div className="mt-1 flex justify-between font-semibold text-slate-800">
                    <span>{language === 'ar' ? 'إجمالي المرتجع' : 'Voucher refund'}</span>
                    <span className="font-mono">{c} {refundAmount.toFixed(settings.decimalPoints ?? 2)}</span>
                  </div>
                </div>
              ))}
              <div className="border-t border-violet-200 pt-2 space-y-1 text-xs">
                <div className="flex justify-between text-slate-700">
                  <span>{language === 'ar' ? 'إجمالي الفاتورة الأصلية' : 'Original sale total'}</span>
                  <span className="font-mono">{c} {sale.total.toFixed(settings.decimalPoints ?? 2)}</span>
                </div>
                <div className="flex justify-between text-violet-800">
                  <span>{language === 'ar' ? 'إجمالي المبالغ المستردة' : 'Total refunded'}</span>
                  <span className="font-mono">−{c} {totalRefunded.toFixed(settings.decimalPoints ?? 2)}</span>
                </div>
                <div className="flex justify-between font-bold text-slate-950">
                  <span>{language === 'ar' ? 'الصافي بعد المرتجعات' : 'Net after returns'}</span>
                  <span className="font-mono">{c} {netAfterReturns.toFixed(settings.decimalPoints ?? 2)}</span>
                </div>
                {showTax && (
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>{language === 'ar' ? 'ضريبة مستردة (ضمن المبلغ أعلاه)' : 'VAT refunded (included above)'}</span>
                    <span className="font-mono">{c} {taxRefunded.toFixed(settings.decimalPoints ?? 2)}</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {printError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {printError}
            </div>
          )}

        </div>

        <div className={`receipt-print-source${showPrintPreview ? ' receipt-print-preview-active' : ''}`}>
          {activeFormat === 'A4' ? (
            /* ======================================================== */
            /* A4 FORMAT TAX INVOICE                                    */
            /* ======================================================== */
            <div
              className="thermal-receipt-print-area paper-a4"
              style={{
                '--invoice-margin-top': `${invoiceMarginsMm.top}mm`,
                '--invoice-margin-right': `${invoiceMarginsMm.right}mm`,
                '--invoice-margin-bottom': `${invoiceMarginsMm.bottom}mm`,
                '--invoice-margin-left': `${invoiceMarginsMm.left}mm`,
              } as React.CSSProperties}
            >
              {a4ItemPages.map((pageItems, pageIndex) => (
                <section className="a4-invoice-page" key={`invoice-page-${pageIndex + 1}`}>
              {/* Header Box: Store Information & Invoice Title */}
              <div className="border-b-2 border-slate-900 pb-3 flex flex-col sm:flex-row justify-between items-start gap-3">
                <div className="space-y-0.5">
                  <div className="text-lg font-black text-slate-950 uppercase tracking-tight">
                    {settings.storeName}
                  </div>
                  {settings.storeNameAr && (
                    <div className="text-sm font-bold text-slate-800 font-arabic" dir="rtl">
                      {settings.storeNameAr}
                    </div>
                  )}
                  {showAddress && (
                    <div className="text-[10px] text-slate-600 max-w-sm pt-0.5 leading-snug">
                      {settings.address}
                      {settings.phone && <span> · Tel: {settings.phone}</span>}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono text-slate-700 pt-0.5">
                    {settings.taxId && <span><strong>VAT ID / الرقم الضريبي:</strong> {settings.taxId}</span>}
                    {settings.crNumber && <span><strong>CR / السجل:</strong> {settings.crNumber}</span>}
                  </div>
                </div>

                <div className="sm:text-right space-y-0.5 shrink-0">
                  <div className="inline-block px-2.5 py-0.5 bg-slate-900 text-white text-[11px] font-bold uppercase tracking-wider rounded">
                    Tax Invoice / فاتورة ضريبية
                  </div>
                  <div className="font-mono text-xs font-bold text-slate-900 pt-0.5">
                    #{sale.receiptNumber}
                  </div>
                  {sale.kotNumber && (
                    <div className="text-[10px] text-slate-600 font-mono">
                      KOT No. / رقم سند المطبخ: {sale.kotNumber}
                    </div>
                  )}
                  <div className="text-[10px] text-slate-500 font-mono">
                    Date / التاريخ: {formattedDate}
                  </div>
                  {showCashier && (
                    <div className="text-[10px] text-slate-500">
                      Cashier / الكاشير: <span className="font-medium text-slate-800">{sale.cashierName}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Customer & Transaction Ledger Section */}
              {showCustomer && (
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider block">
                      Customer / بيانات العميل
                    </span>
                    <div className="font-bold text-slate-900 text-xs mt-0.5">{sale.customerName}</div>
                    <div className="text-slate-500 text-[10px]">Client Account / عميل مسجل</div>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider block">
                      Payment / طريقة الدفع
                    </span>
                    <div className="font-bold text-slate-900 text-xs mt-0.5">{sale.paymentMethod}</div>
                    <div className="text-slate-500 text-[10px]">
                      Status: <span className="font-semibold text-emerald-700">PAID / مدفوعة</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Line Items Table */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 text-[10px]">
                      <th className="py-1.5 px-2.5 w-7 text-center">#</th>
                      <th className="py-1.5 px-2.5">Item Description / بيان الصنف</th>
                      <th className="py-1.5 px-2 text-center w-16">Qty / الكمية</th>
                      <th className="py-1.5 px-2.5 text-right w-24">Price / السعر</th>
                      {showTax && <th className="py-1.5 px-2 text-right w-16">VAT</th>}
                      <th className="py-1.5 px-2.5 text-right w-24">Total / الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                    {pageItems.map((item, pageItemIndex) => (
                      <tr key={item.id} className="hover:bg-slate-50/70">
                        <td className="py-1.5 px-2.5 text-center text-slate-400 text-[10px]">
                          {pageIndex * A4_ITEMS_PER_PAGE + pageItemIndex + 1}
                        </td>
                        <td className="py-1.5 px-2.5 font-sans">
                          {showNameEn && (
                            <div className="font-semibold text-slate-900 text-xs leading-tight">
                              {item.productName}
                            </div>
                          )}
                          {showNameAr && item.nameAr && (
                            <div className="text-[10px] text-slate-600 font-arabic font-medium leading-tight mt-0.5" dir="rtl">
                              {item.nameAr}
                            </div>
                          )}
                          {item.unitName && (
                            <div className="text-[9px] text-slate-500">{item.unitName}</div>
                          )}
                          {showBarcode && item.sku && (
                            <div className="text-[9px] text-slate-400 font-mono mt-0.5">
                              SKU: {item.sku}
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-center font-bold text-slate-900">
                          {item.quantity}
                          {item.unitName && <div className="text-[9px] font-normal text-slate-500">{item.unitName}</div>}
                        </td>
                        <td className="py-1.5 px-2.5 text-right text-slate-700">
                          {c} {item.unitPrice.toFixed(2)}
                        </td>
                        {showTax && (
                          <td className="py-1.5 px-2 text-right text-slate-500 text-[10px]">
                            {sale.taxRate}%
                          </td>
                        )}
                        <td className="py-1.5 px-2.5 text-right font-bold text-slate-900">
                          {c} {item.lineTotal.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Financial Totals & QR Code Grid */}
              <div className="a4-invoice-bottom">
              {pageIndex === a4ItemPages.length - 1 && <div className="a4-invoice-summary grid grid-cols-2 gap-4 items-start">
                {/* Left: Invoice QR Code */}
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                  <div className="flex items-center gap-2.5">
                    {showQr && (
                      <div className="w-28 h-28 bg-white border border-slate-200 p-1 rounded-md flex items-center justify-center shrink-0">
                        {zatcaQrDataUrl ? (
                          <img
                            src={zatcaQrDataUrl}
                            alt="Invoice QR Code"
                            className="w-26 h-26 object-contain"
                          />
                        ) : (
                          <QrCode className="w-20 h-20 text-slate-900" />
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: Financial Breakdown Box */}
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1 text-[11px] font-mono">
                  {showTax && (
                    <div className="flex justify-between text-slate-600">
                      <span>Subtotal (Excl. Tax / غير شامل):</span>
                      <span className="font-semibold text-slate-900">
                        {c} {subtotalExcl.toFixed(settings.decimalPoints ?? 2)}
                      </span>
                    </div>
                  )}
                  {sale.discountAmount > 0 && (
                    <div className="flex justify-between text-amber-700">
                      <span>Discount / الخصم:</span>
                      <span className="font-semibold">
                        -{c} {sale.discountAmount.toFixed(settings.decimalPoints ?? 2)}
                      </span>
                    </div>
                  )}
                  {showTax && (
                    <div className="flex justify-between text-slate-600">
                      <span>VAT / الضريبة ({sale.taxRate}%):</span>
                      <span className="font-semibold text-slate-900">
                        {c} {sale.taxAmount.toFixed(settings.decimalPoints ?? 2)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-black text-slate-950 pt-1.5 border-t-2 border-slate-300">
                    <span className="font-sans">Total / الإجمالي:</span>
                    <span>
                      {c} {sale.total.toFixed(settings.decimalPoints ?? 2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600 pt-0.5 text-[10px]">
                    <span>Paid / المدفوع ({sale.paymentMethod}):</span>
                    <span>{c} {sale.amountTendered.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600 text-[10px]">
                    <span>Change Due / المتبقي:</span>
                    <span>{c} {sale.changeDue.toFixed(2)}</span>
                  </div>
                </div>
              </div>}

              {pageIndex === a4ItemPages.length - 1 && returnDetails.length > 0 && (
                <section className="rounded-lg border border-violet-200 overflow-hidden">
                  <div className="bg-violet-50 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-violet-950">
                    Return Vouchers / سندات المرتجع
                  </div>
                  <div className="divide-y divide-violet-100 px-2.5">
                    {returnDetails.map(({ voucher, items, refundAmount }) => (
                      <div key={voucher.id} className="py-2 text-[10px]">
                        <div className="flex justify-between gap-2 font-semibold text-slate-800">
                          <span>{voucher.voucherNumber}</span>
                          <span className="text-right text-slate-500">{formatReturnDate(voucher.createdAt)}</span>
                        </div>
                        {items.map((item) => (
                          <div key={`${voucher.id}-${item.saleItemId}`} className="mt-1 flex justify-between gap-2 text-slate-600">
                            <span className="min-w-0">
                              {item.productName} × {item.quantity}{item.unitName ? ` ${item.unitName}` : ''}
                            </span>
                            <span className="shrink-0 font-mono">{c} {item.refundAmount.toFixed(settings.decimalPoints ?? 2)}</span>
                          </div>
                        ))}
                        <div className="mt-1 flex justify-between font-semibold text-slate-800">
                          <span>Voucher refund / إجمالي المرتجع</span>
                          <span className="font-mono">{c} {refundAmount.toFixed(settings.decimalPoints ?? 2)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-violet-200 bg-violet-50/50 px-2.5 py-2 space-y-1 text-[10px]">
                    <div className="flex justify-between">
                      <span>Original sale total / إجمالي الفاتورة الأصلية</span>
                      <span className="font-mono">{c} {sale.total.toFixed(settings.decimalPoints ?? 2)}</span>
                    </div>
                    <div className="flex justify-between text-violet-800">
                      <span>Total refunded / إجمالي المبالغ المستردة</span>
                      <span className="font-mono">−{c} {totalRefunded.toFixed(settings.decimalPoints ?? 2)}</span>
                    </div>
                    {showTax && (
                      <div className="flex justify-between text-slate-500">
                        <span>VAT refunded (included above) / الضريبة المستردة (ضمن المبلغ أعلاه)</span>
                        <span className="font-mono">{c} {taxRefunded.toFixed(settings.decimalPoints ?? 2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-violet-200 pt-1 font-bold text-slate-950">
                      <span>Net after returns / الصافي بعد المرتجعات</span>
                      <span className="font-mono">{c} {netAfterReturns.toFixed(settings.decimalPoints ?? 2)}</span>
                    </div>
                    {showTax && (
                      <div className="flex justify-between text-slate-500">
                        <span>Net VAT / صافي الضريبة</span>
                        <span className="font-mono">{c} {netTaxAfterReturns.toFixed(settings.decimalPoints ?? 2)}</span>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Footer Note */}
              <footer className="a4-invoice-footer">
                {showFooter && (
                  <div className="border-t border-slate-200 pt-2 text-center space-y-0.5 text-slate-500 text-[10px]">
                    <div>{settings.receiptFooter}</div>
                    {settings.receiptFooterAr && (
                      <div className="font-arabic" dir="rtl">{settings.receiptFooterAr}</div>
                    )}
                  </div>
                )}
                <div className="text-right text-[9px] text-slate-500">
                  Page {pageIndex + 1} of {a4ItemPages.length}
                </div>
              </footer>
              </div>
                </section>
              ))}
            </div>
          ) : (
            /* ======================================================== */
            /* THERMAL RECEIPT ROLL FORMAT (80mm / 58mm)               */
            /* ======================================================== */
            <div
              className={`thermal-receipt-print-area bg-white text-slate-950 font-mono text-xs leading-relaxed p-5 border border-slate-200 shadow-sm ${
                activeFormat === '58mm' ? 'w-[240px] paper-58mm' : 'w-[310px]'
              }`}
              style={{
                '--invoice-margin-top': `${invoiceMarginsMm.top}mm`,
                '--invoice-margin-right': `${invoiceMarginsMm.right}mm`,
                '--invoice-margin-bottom': `${invoiceMarginsMm.bottom}mm`,
                '--invoice-margin-left': `${invoiceMarginsMm.left}mm`,
              } as React.CSSProperties}
            >
              {/* Thermal Header */}
              <div className="text-center border-b border-dashed border-slate-300 pb-3 mb-3">
                <div className="text-sm font-bold uppercase tracking-wide text-slate-950">
                  {settings.storeName}
                </div>
                {settings.storeNameAr && (
                  <div className="text-xs font-bold text-slate-900 mt-0.5" dir="rtl">
                    {settings.storeNameAr}
                  </div>
                )}
                <div className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-1">
                  Simplified Tax Invoice / فاتورة ضريبية مبسطة
                </div>
                {settings.crNumber && (
                  <div className="text-[10px] text-slate-700 mt-0.5">
                    CR / س.ت: {settings.crNumber}
                  </div>
                )}
                {settings.taxId && (
                  <div className="text-[10px] text-slate-700">
                    VAT / الرقم الضريبي: {settings.taxId}
                  </div>
                )}
                {showAddress && (
                  <>
                    <div className="text-[10px] text-slate-600 mt-0.5">{settings.address}</div>
                    {settings.phone && (
                      <div className="text-[10px] text-slate-600">Tel: {settings.phone}</div>
                    )}
                  </>
                )}
              </div>

              {/* Receipt Metadata */}
              <div className="space-y-0.5 text-[11px] border-b border-dashed border-slate-300 pb-2.5 mb-2.5">
                <div className="flex justify-between">
                  <span className="text-slate-600">Receipt:</span>
                  <span className="font-semibold">{sale.receiptNumber}</span>
                </div>
                {sale.kotNumber && (
                  <div className="flex justify-between">
                    <span className="text-slate-600">KOT No.:</span>
                    <span className="font-semibold">{sale.kotNumber}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-600">Date:</span>
                  <span>{formattedDate}</span>
                </div>
                {showCashier && (
                  <div className="flex justify-between">
                    <span className="text-slate-600">Cashier:</span>
                    <span>{sale.cashierName}</span>
                  </div>
                )}
                {showCustomer && (
                  <div className="flex justify-between">
                    <span className="text-slate-600">Customer:</span>
                    <span>{sale.customerName}</span>
                  </div>
                )}
              </div>

              {sale.status === 'VOIDED' && (
                <div className="text-center font-bold text-red-700 border border-red-300 py-1 mb-2.5 text-[11px]">
                  VOIDED TRANSACTION
                </div>
              )}

              {/* Line Items */}
              <div className="border-b border-dashed border-slate-300 pb-2.5 mb-2.5 space-y-2">
                {sale.items.map((item) => (
                  <div key={item.id}>
                    {showNameEn && (
                      <div className="font-medium text-slate-900 truncate">{item.productName}</div>
                    )}
                    {showNameAr && item.nameAr && (
                      <div className="text-[10px] text-slate-600 truncate" dir="rtl">
                        {item.nameAr}
                      </div>
                    )}
                    {item.unitName && (
                      <div className="text-[9px] text-slate-500">{item.unitName}</div>
                    )}
                    {showBarcode && item.sku && (
                      <div className="text-[9px] text-slate-400 font-mono">
                        SKU: {item.sku}
                      </div>
                    )}
                    <div className="flex justify-between text-[11px] text-slate-700">
                      <span>
                        {item.quantity}{item.unitName ? ` ${item.unitName}` : ''} x {c} {item.unitPrice.toFixed(2)}
                      </span>
                      <span className="font-semibold text-slate-900">
                        {c} {item.lineTotal.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Totals Breakdown */}
              <div className="space-y-1 text-[11px] border-b border-dashed border-slate-300 pb-2.5 mb-2.5">
                {showTax && (
                  <div className="flex justify-between">
                    <span className="text-slate-600">Subtotal (Excl. Tax / غير شامل)</span>
                    <span>
                      {c} {subtotalExcl.toFixed(settings.decimalPoints ?? 2)}
                    </span>
                  </div>
                )}
                {sale.discountAmount > 0 && (
                  <div className="flex justify-between text-slate-700">
                    <span>
                      Discount (
                      {sale.discountType === 'percent'
                        ? `${sale.discountValue}%`
                        : `${c}${sale.discountValue.toFixed(settings.decimalPoints ?? 2)}`}
                      )
                    </span>
                    <span>
                      -{c} {sale.discountAmount.toFixed(settings.decimalPoints ?? 2)}
                    </span>
                  </div>
                )}
                {showTax && (
                  <div className="flex justify-between">
                    <span className="text-slate-600">
                      VAT / ضريبة ({sale.taxRate}%)
                    </span>
                    <span>
                      {c} {sale.taxAmount.toFixed(settings.decimalPoints ?? 2)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-slate-950 pt-1 border-t border-slate-200">
                  <span>TOTAL / الإجمالي شامل الضريبة</span>
                  <span>
                    {c} {sale.total.toFixed(settings.decimalPoints ?? 2)}
                  </span>
                </div>
              </div>

              {returnDetails.length > 0 && (
                <section className="border-b border-dashed border-slate-300 pb-2.5 mb-2.5">
                  <div className="font-bold text-slate-950 mb-1">Return Vouchers / سندات المرتجع</div>
                  {returnDetails.map(({ voucher, items, refundAmount }) => (
                    <div key={voucher.id} className="py-1.5 border-t border-dashed border-slate-300">
                      <div className="flex justify-between gap-2 font-bold">
                        <span>{voucher.voucherNumber}</span>
                        <span className="text-right">{formatReturnDate(voucher.createdAt)}</span>
                      </div>
                      {items.map((item) => (
                        <div key={`${voucher.id}-${item.saleItemId}`} className="flex justify-between gap-2 text-slate-600">
                          <span className="min-w-0">
                            {item.productName} × {item.quantity}{item.unitName ? ` ${item.unitName}` : ''}
                          </span>
                          <span className="shrink-0">{c} {item.refundAmount.toFixed(settings.decimalPoints ?? 2)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between font-semibold">
                        <span>Voucher refund</span>
                        <span>{c} {refundAmount.toFixed(settings.decimalPoints ?? 2)}</span>
                      </div>
                    </div>
                  ))}
                  <div className="border-t border-slate-300 pt-1.5 mt-1.5 space-y-1">
                    <div className="flex justify-between">
                      <span>Original sale total</span>
                      <span>{c} {sale.total.toFixed(settings.decimalPoints ?? 2)}</span>
                    </div>
                    <div className="flex justify-between text-violet-800">
                      <span>Total refunded</span>
                      <span>−{c} {totalRefunded.toFixed(settings.decimalPoints ?? 2)}</span>
                    </div>
                    {showTax && (
                      <div className="flex justify-between text-slate-500">
                        <span>VAT refunded (included above)</span>
                        <span>{c} {taxRefunded.toFixed(settings.decimalPoints ?? 2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-slate-950 border-t border-slate-300 pt-1">
                      <span>Net after returns</span>
                      <span>{c} {netAfterReturns.toFixed(settings.decimalPoints ?? 2)}</span>
                    </div>
                    {showTax && (
                      <div className="flex justify-between text-slate-500">
                        <span>Net VAT</span>
                        <span>{c} {netTaxAfterReturns.toFixed(settings.decimalPoints ?? 2)}</span>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Payment Details */}
              <div className="space-y-0.5 text-[11px] border-b border-dashed border-slate-300 pb-3 mb-3">
                <div className="flex justify-between">
                  <span className="text-slate-600">Paid ({sale.paymentMethod})</span>
                  <span>{c} {sale.amountTendered.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Change Due</span>
                  <span>{c} {sale.changeDue.toFixed(2)}</span>
                </div>
              </div>

              {/* QR Code & Footer */}
              <div className="text-center space-y-2">
                {showQr && (
                  <div className="w-28 h-28 mx-auto bg-white border border-slate-200 rounded p-1 flex items-center justify-center">
                    {zatcaQrDataUrl ? (
                      <img
                        src={zatcaQrDataUrl}
                        alt="Invoice QR Code"
                        className="w-26 h-26 object-contain"
                      />
                    ) : (
                      <QrCode className="w-16 h-16 text-slate-900" />
                    )}
                  </div>
                )}

                {showFooter && (
                  <>
                    <p className="text-[11px] text-slate-700 leading-snug pt-1">
                      {settings.receiptFooter}
                    </p>
                    {settings.receiptFooterAr && (
                      <p className="text-[11px] text-slate-700 leading-snug" dir="rtl">
                        {settings.receiptFooterAr}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="no-print px-5 py-4 bg-white border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
          <span className="text-[10px] text-slate-400">
            {language === 'ar' ? 'Enter للإنهاء · F12 للطباعة' : 'Enter to finish · F12 to print'}
          </span>
          <div className="flex items-center gap-2">
            {window.electronAPI?.isElectron && (
              <label
                className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-[10px] text-slate-600"
                title="Preview the receipt before printing"
              >
                <input
                  type="checkbox"
                  checked={previewBeforePrint}
                  onChange={(event) => setPreviewBeforePrint(event.target.checked)}
                  className="accent-blue-700"
                />
                <span>{language === 'ar' ? 'معاينة قبل الطباعة' : 'Preview before printing'}</span>
              </label>
            )}
            <button
              type="button"
              onClick={handlePrintAndClose}
              title="Print receipt"
              className="inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-blue-700 bg-white border border-blue-200 hover:bg-blue-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{previewBeforePrint ? 'Preview Receipt' : 'Print Receipt'}</span>
            </button>
            <button
              ref={primaryActionBtnRef}
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shadow-sm"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Done</span>
            </button>
          </div>
        </div>
      </div>
      {showPrintPreview && (
        <div className="receipt-preview-controls no-print fixed bottom-4 left-1/2 z-[70] flex w-[min(94vw,480px)] -translate-x-1/2 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900">
              {language === 'ar' ? 'معاينة الفاتورة' : 'Receipt preview'}
            </div>
            {printError && (
              <div role="alert" className="mt-1 text-xs text-red-700">{printError}</div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPrintPreview(false)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {language === 'ar' ? 'رجوع' : 'Back'}
            </button>
            <button
              type="button"
              onClick={handlePrintAndClose}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800"
            >
              <Printer className="h-3.5 w-3.5" />
              {language === 'ar' ? 'طباعة' : 'Print'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
