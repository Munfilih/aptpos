import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Printer, X, Check, Banknote, CreditCard, Receipt, Eye } from 'lucide-react';
import QRCode from 'qrcode';
import type { PaperWidth, Sale, SalesReturnVoucher, StoreSettings } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { generateZatcaTlvBase64 } from '../utils/zatcaQr';
import { getPrintedSalesTaxBreakdown } from '../utils/salesTax';
import { getInvoiceDateTime } from '../utils/dateFilters';
import type { ThermalPageSize } from '../utils/thermalPrinting';
import { createVoucherTemplateJob, printTemplateJob } from '../printTemplates/render';
import { getPrintDocumentFormat } from '../printTemplates/catalog';

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
  const isAr = language === 'ar';
  const activeFormat: PaperWidth = getPrintDocumentFormat(
    settings,
    'sales-invoice',
    settings.paperWidth || '80mm'
  );
  const printedTaxBreakdown = useMemo(
    () => getPrintedSalesTaxBreakdown(sale, settings.taxType),
    [sale, settings.taxType]
  );

  const [zatcaQrDataUrl, setZatcaQrDataUrl] = useState<string>('');
  const [printError, setPrintError] = useState<string | null>(null);
  const [previewBeforePrint, setPreviewBeforePrint] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [isPrintingReceipt, setIsPrintingReceipt] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewPageSize, setPreviewPageSize] = useState<ThermalPageSize | null>(null);

  useEffect(() => {
    let isMounted = true;
    const seller = settings.storeNameAr || settings.storeName || 'aptPOS Retail';
    const vat = settings.taxId || '300000000000003';
    const total = sale.total;
    const tax = printedTaxBreakdown.taxAmount;
    const time = getInvoiceDateTime(sale.invoiceDate, sale.createdAt).toISOString();

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
        if (isMounted) setZatcaQrDataUrl(url);
      }).catch(console.error);
    } catch (e) {
      console.error('Failed to generate invoice QR code:', e);
    }

    return () => {
      isMounted = false;
    };
  }, [sale, settings, printedTaxBreakdown]);

  const primaryActionBtnRef = useRef<HTMLButtonElement>(null);

  const c = settings.currencySymbol || 'SAR';
  const decimals = settings.decimalPoints ?? 2;
  const formattedDate = getInvoiceDateTime(sale.invoiceDate, sale.createdAt).toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const handlePrint = async () => {
    setPrintError(null);
    setIsPrintingReceipt(true);
    try {
      const job = await createVoucherTemplateJob(
        'sales-invoice',
        sale.id,
        settings,
        activeFormat,
        isAr,
        zatcaQrDataUrl
      );
      const printJob = showPrintPreview && previewHtml && previewPageSize
        ? { ...job, html: previewHtml, pageSize: previewPageSize }
        : job;
      return await printTemplateJob(printJob);
    } catch (error) {
      console.error('Failed to print receipt:', error);
      setPrintError((error as Error).message || 'Receipt could not be printed.');
      return false;
    } finally {
      setIsPrintingReceipt(false);
    }
  };

  const openPrintPreview = async () => {
    setPrintError(null);
    setIsPrintingReceipt(true);
    try {
      const job = await createVoucherTemplateJob(
        'sales-invoice',
        sale.id,
        settings,
        activeFormat,
        isAr,
        zatcaQrDataUrl
      );
      setPreviewHtml(job.html);
      setPreviewPageSize(job.pageSize);
      setShowPrintPreview(true);
    } catch (error) {
      console.error('Failed to prepare receipt preview:', error);
      setPrintError((error as Error).message || 'Receipt preview could not be opened.');
    } finally {
      setIsPrintingReceipt(false);
    }
  };

  const handlePrintAndClose = async () => {
    if (previewBeforePrint && !showPrintPreview) {
      await openPrintPreview();
      return;
    }
    const success = await handlePrint();
    if (success) {
      onClose();
    }
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
  const formatReturnDate = (date: string) =>
    new Date(date).toLocaleString(isAr ? 'ar-SA' : 'en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  const autoPrint = Boolean(settings.autoPrintReceiptOnSale);

  return (
    <div
      className="invoice-print-modal fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tender-modal-title"
    >
      <div className="invoice-print-dialog bg-white border border-slate-200 rounded-2xl w-full max-w-lg max-h-[92vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="no-print px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3 shrink-0 bg-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <Check className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 id="tender-modal-title" className="text-base font-bold text-slate-900">
                {isAr ? 'تم إتمام البيع' : 'Sale Complete'}
              </h2>
              <p className="text-xs text-slate-500">
                {isAr ? 'تم تسجيل عملية الدفع بنجاح' : 'Payment has been recorded successfully'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label={isAr ? 'إغلاق' : 'Close'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {queuedOffline && (
          <div className="no-print px-5 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-900 font-medium">
            {isAr
              ? 'تم حفظ الإيصال في قائمة الطباعة دون اتصال.'
              : 'Receipt saved to the offline print queue. You can print it later.'}
          </div>
        )}

        <div className="no-print flex-1 overflow-y-auto p-5 space-y-4">
          <div className="rounded-xl bg-slate-950 text-white p-5 text-center">
            <div className="text-xs font-medium text-slate-300">
              {isAr ? 'المبلغ الإجمالي' : 'TOTAL DUE'}
            </div>
            <div className="mt-1 font-mono text-3xl font-bold tabular-nums">
              {c} {sale.total.toFixed(decimals)}
            </div>
            <div className="mt-2 font-mono text-xs text-slate-300">
              {sale.receiptNumber} · {formattedDate}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
            <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <span className="flex items-center gap-2 text-slate-600">
                {sale.paymentMethod === 'Cash'
                  ? <Banknote className="h-4 w-4 text-slate-400" />
                  : <CreditCard className="h-4 w-4 text-slate-400" />}
                {isAr ? 'طريقة الدفع' : 'Payment method'}
              </span>
              <span className="font-semibold text-slate-900">{sale.paymentMethod}</span>
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <span className="text-slate-600">{isAr ? 'المبلغ المستلم' : 'Amount received'}</span>
              <span className="font-semibold font-mono tabular-nums text-slate-900">
                {c} {sale.amountTendered.toFixed(decimals)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <span className="font-semibold text-slate-900">{isAr ? 'الباقي' : 'Change due'}</span>
              <span className="font-bold font-mono tabular-nums text-emerald-700">
                {c} {sale.changeDue.toFixed(decimals)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3 text-xs">
              <span className="text-slate-500">{isAr ? 'العميل' : 'Customer'}</span>
              <span className="font-medium text-slate-700 text-right">{sale.customerName}</span>
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3 text-xs">
              <span className="flex items-center gap-2 text-slate-500">
                <Receipt className="h-4 w-4 text-slate-400" />
                {isAr ? 'الأصناف' : 'Items'}
              </span>
              <span className="font-medium text-slate-700">
                {sale.items.reduce((count, item) => count + item.quantity, 0)}
              </span>
            </div>
          </div>

          {returnDetails.length > 0 && (
            <section className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 space-y-3">
              <h3 className="text-sm font-bold text-violet-950">
                {isAr ? 'مرتجعات مرتبطة بهذه الفاتورة' : 'Returns linked to this invoice'}
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
                      <span className="shrink-0 font-mono">{c} {item.refundAmount.toFixed(decimals)}</span>
                    </div>
                  ))}
                  <div className="mt-1 flex justify-between font-semibold text-slate-800">
                    <span>{isAr ? 'إجمالي المرتجع' : 'Voucher refund'}</span>
                    <span className="font-mono">{c} {refundAmount.toFixed(decimals)}</span>
                  </div>
                </div>
              ))}
              <div className="border-t border-violet-200 pt-2 space-y-1 text-xs">
                <div className="flex justify-between text-slate-700">
                  <span>{isAr ? 'إجمالي الفاتورة الأصلية' : 'Original sale total'}</span>
                  <span className="font-mono">{c} {sale.total.toFixed(decimals)}</span>
                </div>
                <div className="flex justify-between text-violet-800">
                  <span>{isAr ? 'إجمالي المبالغ المستردة' : 'Total refunded'}</span>
                  <span className="font-mono">−{c} {totalRefunded.toFixed(decimals)}</span>
                </div>
                <div className="flex justify-between font-bold text-slate-950">
                  <span>{isAr ? 'الصافي بعد المرتجعات' : 'Net after returns'}</span>
                  <span className="font-mono">{c} {netAfterReturns.toFixed(decimals)}</span>
                </div>
                <div className="flex justify-between text-[10px] text-slate-500">
                  <span>{isAr ? 'ضريبة مستردة (ضمن المبلغ أعلاه)' : 'VAT refunded (included above)'}</span>
                  <span className="font-mono">{c} {taxRefunded.toFixed(decimals)}</span>
                </div>
              </div>
            </section>
          )}

          {printError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {printError}
            </div>
          )}
        </div>

        <div className="no-print px-5 py-4 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-slate-400">
              {isAr ? 'Enter للإنهاء · F12 للطباعة' : 'Enter to finish · F12 to print'}
            </span>
            {window.electronAPI?.isElectron && (
              <label
                className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-[10px] text-slate-600"
                title={isAr ? 'معاينة الفاتورة قبل الطباعة' : 'Preview receipt before printing'}
              >
                <input
                  type="checkbox"
                  checked={previewBeforePrint}
                  onChange={(event) => setPreviewBeforePrint(event.target.checked)}
                  className="accent-blue-700"
                />
                <span>{isAr ? 'معاينة قبل الطباعة' : 'Preview first'}</span>
              </label>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isPrintingReceipt}
              onClick={() => void openPrintPreview()}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{isAr ? 'معاينة' : 'Preview'}</span>
            </button>
            <button
              ref={autoPrint ? primaryActionBtnRef : undefined}
              type="button"
              disabled={isPrintingReceipt}
              onClick={() => void handlePrintAndClose()}
              className={autoPrint
                ? 'inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shadow-sm'
                : 'inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-blue-700 bg-white border border-blue-200 hover:bg-blue-50 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap'}
            >
              <Printer className="w-3.5 h-3.5" />
              <span>
                {isPrintingReceipt
                  ? (isAr ? 'جارٍ الطباعة...' : 'Printing...')
                  : (isAr ? 'طباعة الفاتورة' : 'Print Receipt')}
              </span>
            </button>
            <button
              ref={autoPrint ? undefined : primaryActionBtnRef}
              type="button"
              onClick={onClose}
              className={autoPrint
                ? 'inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap'
                : 'inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shadow-sm'}
            >
              <Check className="w-3.5 h-3.5" />
              <span>{isAr ? 'تم' : 'Done'}</span>
            </button>
          </div>
        </div>
      </div>

      {showPrintPreview && previewHtml && previewPageSize && (
        <div className="receipt-standalone-preview no-print fixed inset-0 z-[60] flex items-start justify-center overflow-auto bg-slate-950/80 px-3 pt-5 pb-24">
          <iframe
            title={isAr ? 'معاينة نسخة الطباعة' : 'Exact receipt print preview'}
            srcDoc={previewHtml}
            sandbox=""
            className="max-w-full shrink-0 bg-white shadow-2xl"
            style={{
              width: `${previewPageSize.width / 1000}mm`,
              height: `${previewPageSize.height / 1000}mm`,
              maxHeight: 'calc(100vh - 120px)',
              border: 0,
            }}
          />
        </div>
      )}

      {showPrintPreview && (
        <div className="receipt-preview-controls no-print fixed bottom-4 left-1/2 z-[70] flex w-[min(94vw,480px)] -translate-x-1/2 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900">
              {isAr ? 'معاينة الفاتورة' : 'Receipt preview'}
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
              {isAr ? 'رجوع' : 'Back'}
            </button>
            <button
              type="button"
              disabled={isPrintingReceipt}
              onClick={() => void handlePrintAndClose()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              <Printer className="h-3.5 w-3.5" />
              {isPrintingReceipt
                ? (isAr ? 'جارٍ الطباعة...' : 'Printing...')
                : (isAr ? 'طباعة' : 'Print')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
