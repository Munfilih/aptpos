import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Clock3,
  Download,
  FileText,
  KeyRound,
  Loader2,
  LockKeyhole,
  Printer,
  SlidersHorizontal,
  UnlockKeyhole,
  Wallet,
  X,
} from 'lucide-react';
import type {
  CashierShift,
  CashierShiftReport,
  PaperWidth,
  ShiftBankAccountSummary,
  ShiftPaymentSummary,
  StoreSettings,
  ThemeMode,
  UserSession,
} from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import {
  createPrintTemplateJob,
  printTemplateJob,
} from '../printTemplates/render';
import { getPrintDocumentFormat, resolvePrintTemplate } from '../printTemplates/catalog';
import type { PrintDocumentData } from '../printTemplates/types';
import {
  OneTimeTemplateModal,
  type OneTimeDocumentOverride,
} from './OneTimeTemplateModal';

interface ShiftViewProps {
  currentUser: UserSession;
  settings: StoreSettings;
  theme: ThemeMode;
}

interface ShiftOverview {
  active: CashierShift | null;
  history: CashierShift[];
}

function isCashierShift(value: unknown): value is CashierShift {
  if (!value || typeof value !== 'object') return false;
  const shift = value as Record<string, unknown>;
  return (
    typeof shift.id === 'number' &&
    typeof shift.cashierUsername === 'string' &&
    typeof shift.cashierName === 'string' &&
    typeof shift.openedAt === 'string' &&
    typeof shift.openingCash === 'number' &&
    (shift.closedAt === null || typeof shift.closedAt === 'string') &&
    (shift.closingCash === null || typeof shift.closingCash === 'number')
  );
}

function isShiftPaymentSummary(value: unknown): value is ShiftPaymentSummary {
  if (!value || typeof value !== 'object') return false;
  const summary = value as Record<string, unknown>;
  return (
    typeof summary.paymentMethod === 'string' &&
    typeof summary.count === 'number' &&
    typeof summary.amount === 'number'
  );
}

function isShiftBankAccountSummary(value: unknown): value is ShiftBankAccountSummary {
  if (!value || typeof value !== 'object') return false;
  const summary = value as Record<string, unknown>;
  return (
    typeof summary.accountName === 'string' &&
    typeof summary.count === 'number' &&
    typeof summary.moneyIn === 'number' &&
    typeof summary.moneyOut === 'number'
  );
}

function isCashierShiftReport(value: unknown): value is CashierShiftReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as Record<string, unknown>;
  if (
    typeof report.shiftId !== 'number' ||
    typeof report.from !== 'string' ||
    typeof report.to !== 'string' ||
    typeof report.transactionCount !== 'number'
  ) return false;
  const isPaymentSection = (section: unknown) =>
    Boolean(
      section &&
      typeof section === 'object' &&
      'count' in section &&
      typeof section.count === 'number' &&
      'amount' in section &&
      typeof section.amount === 'number' &&
      'byPaymentMethod' in section &&
      Array.isArray(section.byPaymentMethod) &&
      section.byPaymentMethod.every(isShiftPaymentSummary)
    );
  const isCashbookSection = (section: unknown) =>
    Boolean(
      section &&
      typeof section === 'object' &&
      'count' in section &&
      typeof section.count === 'number' &&
      'countIn' in section &&
      typeof section.countIn === 'number' &&
      'countOut' in section &&
      typeof section.countOut === 'number' &&
      'moneyIn' in section &&
      typeof section.moneyIn === 'number' &&
      'moneyOut' in section &&
      typeof section.moneyOut === 'number'
    );
  if (!isPaymentSection(report.sales) || !isPaymentSection(report.returns) || !isCashbookSection(report.cashbook)) {
    return false;
  }
  if (
    !report.bank ||
    typeof report.bank !== 'object' ||
    !isCashbookSection(report.bank) ||
    !('byAccount' in report.bank) ||
    !Array.isArray(report.bank.byAccount) ||
    !report.bank.byAccount.every(isShiftBankAccountSummary)
  ) return false;
  return true;
}

function getErrorMessage(payload: unknown, fallback: string): string {
  return typeof payload === 'object' &&
    payload !== null &&
    'error' in payload &&
    typeof payload.error === 'string'
    ? payload.error
    : fallback;
}

export const ShiftView: React.FC<ShiftViewProps> = ({ currentUser, settings, theme }) => {
  const { language, isRtl } = useLanguage();
  const cashierUsername = currentUser.username.trim();
  const cashierName = currentUser.displayName?.trim() || cashierUsername;
  const currency = settings.currencySymbol || 'SAR';
  const activeFormat: PaperWidth = getPrintDocumentFormat(
    settings,
    'shift-report',
    settings.paperWidth || '80mm'
  );
  const shiftTemplate = resolvePrintTemplate('shift-report', activeFormat, settings.printDocumentProfiles?.['shift-report']?.[activeFormat]?.templateId);
  const [activeShift, setActiveShift] = useState<CashierShift | null>(null);
  const [activeShiftReport, setActiveShiftReport] = useState<CashierShiftReport | null>(null);
  const [shiftHistory, setShiftHistory] = useState<CashierShift[]>([]);
  const [openingCash, setOpeningCash] = useState('0.00');
  const [closingCash, setClosingCash] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'open' | 'close' | null>(null);
  const [confirmationAction, setConfirmationAction] = useState<'open' | 'close' | null>(null);
  const [confirmationPassword, setConfirmationPassword] = useState('');
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [selectedShift, setSelectedShift] = useState<CashierShift | null>(null);
  const [selectedShiftReport, setSelectedShiftReport] = useState<CashierShiftReport | null>(null);
  const [shiftReportLoading, setShiftReportLoading] = useState(false);
  const [shiftReportError, setShiftReportError] = useState<string | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [oneTimeOverrides, setOneTimeOverrides] = useState<
    Partial<Record<'shift-report', OneTimeDocumentOverride>>
  >({});
  const [printing, setPrinting] = useState(false);
  const [printNotice, setPrintNotice] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isDailyCounterShift =
    settings.enableCounterShift === true && settings.enableDailyCounterShift === true;
  const dailyOpenTime = settings.dailyShiftOpenTime || '00:00';
  const dailyCloseTime = settings.dailyShiftCloseTime || '23:59';
  const dailyCloseNextDay = settings.dailyShiftCloseNextDay === true;
  const dailyShiftDurationLabel = (() => {
    const [oH, oM] = dailyOpenTime.split(':').map(Number);
    const [cH, cM] = dailyCloseTime.split(':').map(Number);
    const diff = (cH || 0) * 60 + (cM || 0) + (dailyCloseNextDay ? 1440 : 0) - ((oH || 0) * 60 + (oM || 0));
    if (diff <= 0) return '';
    return `${Math.floor(diff / 60)}h ${diff % 60}m`;
  })();
  const [dailyDate, setDailyDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [dailyReport, setDailyReport] = useState<CashierShiftReport | null>(null);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [showDailyTemplateModal, setShowDailyTemplateModal] = useState(false);

  const loadShifts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/shifts?cashierUsername=${encodeURIComponent(cashierUsername)}`
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, 'Could not load cashier shifts.'));
      }
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('active' in payload) ||
        !('history' in payload) ||
        (payload.active !== null && !isCashierShift(payload.active)) ||
        !Array.isArray(payload.history) ||
        !payload.history.every(isCashierShift)
      ) {
        throw new Error('Cashier shifts response has an invalid format.');
      }
      const overview = payload as ShiftOverview;
      setActiveShift(overview.active);
      setShiftHistory(overview.history);
      setClosingCash(overview.active?.openingCash.toFixed(2) || '');
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }, [cashierUsername]);

  useEffect(() => {
    void loadShifts();
  }, [loadShifts]);

  // Fetch automatic Daily Counter Shift report when Daily Counter Shift mode is enabled
  useEffect(() => {
    if (!isDailyCounterShift) {
      setDailyReport(null);
      setDailyError(null);
      setDailyLoading(false);
      return;
    }
    let active = true;
    setDailyLoading(true);
    setDailyError(null);
    void fetch(`/api/shifts/daily-report?date=${encodeURIComponent(dailyDate)}`)
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) {
          throw new Error(getErrorMessage(payload, 'Could not load daily counter shift report.'));
        }
        if (!isCashierShiftReport(payload)) {
          throw new Error('Daily shift report response has an invalid format.');
        }
        if (active) setDailyReport(payload);
      })
      .catch((err: unknown) => {
        if (active) {
          setDailyError(err instanceof Error ? err.message : 'Could not load daily counter shift report.');
        }
      })
      .finally(() => {
        if (active) setDailyLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isDailyCounterShift, dailyDate, dailyOpenTime, dailyCloseTime]);

  // Fetch live report for the currently open shift so expected cash & closing difference update in real time
  useEffect(() => {
    if (!activeShift) {
      setActiveShiftReport(null);
      return;
    }
    let active = true;
    void fetch(
      `/api/shifts/${activeShift.id}/report?cashierUsername=${encodeURIComponent(cashierUsername)}`
    )
      .then(async (response) => {
        if (!response.ok) return;
        const payload: unknown = await response.json();
        if (active && isCashierShiftReport(payload) && payload.shiftId === activeShift.id) {
          setActiveShiftReport(payload);
        }
      })
      .catch(() => {
        // Non-blocking background summary fetch for active shift
      });
    return () => {
      active = false;
    };
  }, [activeShift, cashierUsername]);

  useEffect(() => {
    if (!selectedShift) {
      setSelectedShiftReport(null);
      setShiftReportError(null);
      setShiftReportLoading(false);
      return;
    }

    let active = true;
    setSelectedShiftReport(null);
    setShiftReportError(null);
    setShiftReportLoading(true);
    void fetch(
      `/api/shifts/${selectedShift.id}/report?cashierUsername=${encodeURIComponent(cashierUsername)}`
    )
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) {
          throw new Error(getErrorMessage(payload, 'Could not load the shift transaction summary.'));
        }
        if (!isCashierShiftReport(payload) || payload.shiftId !== selectedShift.id) {
          throw new Error('Shift report response has an invalid format.');
        }
        if (active) setSelectedShiftReport(payload);
      })
      .catch((reportError: unknown) => {
        if (active) {
          setShiftReportError(
            reportError instanceof Error
              ? reportError.message
              : 'Could not load the shift transaction summary.'
          );
        }
      })
      .finally(() => {
        if (active) setShiftReportLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedShift, cashierUsername]);

  const requestConfirmation = (action: 'open' | 'close') => {
    setConfirmationPassword('');
    setConfirmationError(null);
    setConfirmationAction(action);
  };

  const handleOpenShift = (event: React.FormEvent) => {
    event.preventDefault();
    const amount = Number(openingCash);
    if (!Number.isFinite(amount) || amount < 0) {
      setError(isRtl ? 'أدخل مبلغاً افتتاحياً صحيحاً.' : 'Enter a valid opening amount.');
      return;
    }
    setError(null);
    requestConfirmation('open');
  };

  const handleCloseShift = (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeShift) return;
    const amount = Number(closingCash);
    if (!Number.isFinite(amount) || amount < 0) {
      setError(isRtl ? 'أدخل مبلغاً ختامياً صحيحاً.' : 'Enter a valid closing amount.');
      return;
    }
    setError(null);
    requestConfirmation('close');
  };

  const handleConfirmShiftAction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!confirmationAction) return;
    if (!confirmationPassword) {
      setConfirmationError(isRtl ? 'أدخل كلمة المرور الحالية.' : 'Enter your current password.');
      return;
    }
    if (confirmationAction === 'close' && !activeShift) {
      setConfirmationError(isRtl ? 'لا توجد وردية مفتوحة.' : 'There is no open shift to close.');
      return;
    }

    const action = confirmationAction;
    setSaving(action);
    setConfirmationError(null);
    try {
      let response: Response;
      if (action === 'open') {
        response = await fetch('/api/shifts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cashierUsername,
              cashierName,
              openingCash: Number(openingCash),
              password: confirmationPassword,
            }),
          });
      } else {
        if (!activeShift) {
          throw new Error(isRtl ? 'لا توجد وردية مفتوحة.' : 'There is no open shift to close.');
        }
        response = await fetch(`/api/shifts/${activeShift.id}/close`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cashierUsername,
              closingCash: Number(closingCash),
              password: confirmationPassword,
            }),
          });
      }
      const payload: unknown = await response.json();
      if (response.status === 401) {
        throw new Error(isRtl ? 'كلمة المرور الحالية غير صحيحة.' : 'The current password is incorrect.');
      }
      if (!response.ok || !isCashierShift(payload)) {
        throw new Error(getErrorMessage(
          payload,
          action === 'open' ? 'Could not open this shift.' : 'Could not close this shift.'
        ));
      }
      if (action === 'open') {
        setActiveShift(payload);
        setClosingCash(payload.openingCash.toFixed(2));
      } else {
        setActiveShift(null);
        setShiftHistory((history) => [payload, ...history].slice(0, 20));
        setOpeningCash('0.00');
        setClosingCash('');
      }
      setConfirmationAction(null);
      setConfirmationPassword('');
    } catch (actionError) {
      setConfirmationPassword('');
      setConfirmationError((actionError as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const formatDate = (value: string) =>
    new Date(value).toLocaleString(language === 'ar' ? 'ar-SA' : 'en-GB');
  const formatAmount = (amount: number) => `${currency} ${amount.toFixed(2)}`;

  const computeExpectedCash = (shift: CashierShift, report: CashierShiftReport | null): number => {
    if (!report) return shift.openingCash;
    const cashSales = report.sales.byPaymentMethod
      .filter((item) => /cash/i.test(item.paymentMethod))
      .reduce((sum, item) => sum + item.amount, 0);
    const cashReturns = report.returns.byPaymentMethod
      .filter((item) => /cash/i.test(item.paymentMethod))
      .reduce((sum, item) => sum + item.amount, 0);
    return Number(
      (shift.openingCash + cashSales - cashReturns + report.cashbook.moneyIn - report.cashbook.moneyOut).toFixed(2)
    );
  };

  const formatDifferenceLabel = (diff: number, bilingual = false): string => {
    const abs = Math.abs(diff);
    if (abs < 0.005) {
      return bilingual
        ? `${formatAmount(0)} (Balanced / متوازن)`
        : `${formatAmount(0)} (${isRtl ? 'متوازن' : 'Balanced'})`;
    }
    const sign = diff > 0 ? '+' : '−';
    const status = diff > 0
      ? (bilingual ? 'Over / زيادة' : isRtl ? 'زيادة' : 'Over')
      : (bilingual ? 'Short / عجز' : isRtl ? 'عجز' : 'Short');
    return `${sign}${formatAmount(abs)} (${status})`;
  };

  const activeExpectedCash = activeShift ? computeExpectedCash(activeShift, activeShiftReport) : 0;
  const parsedClosingCash = closingCash.trim() === '' ? null : Number(closingCash);
  const activeClosingDifference =
    activeShift && parsedClosingCash !== null && Number.isFinite(parsedClosingCash)
      ? Number((parsedClosingCash - activeExpectedCash).toFixed(2))
      : null;

  const selectedExpectedCash = selectedShift
    ? computeExpectedCash(selectedShift, selectedShiftReport)
    : 0;
  const selectedClosingValue = selectedShift
    ? selectedShift.closingCash !== null
      ? selectedShift.closingCash
      : selectedShift.id === activeShift?.id && parsedClosingCash !== null && Number.isFinite(parsedClosingCash)
        ? parsedClosingCash
        : null
    : null;
  const selectedDifference =
    selectedClosingValue !== null
      ? Number((selectedClosingValue - selectedExpectedCash).toFixed(2))
      : null;

  const buildEffectiveSettings = (override?: OneTimeDocumentOverride): StoreSettings => {
    const resolved = override ?? oneTimeOverrides['shift-report'];
    if (!resolved) return settings;
    return {
      ...settings,
      printDocumentFormats: {
        ...settings.printDocumentFormats,
        'shift-report': resolved.format,
      },
      printDocumentProfiles: {
        ...settings.printDocumentProfiles,
        'shift-report': {
          ...settings.printDocumentProfiles?.['shift-report'],
          [resolved.format]: resolved.profile,
        },
      },
    };
  };

  const getShiftPrintData = (): PrintDocumentData => {
    if (!selectedShift || !selectedShiftReport) {
      throw new Error('Shift details are not ready to print.');
    }
    const report = selectedShiftReport;
    const expectedCash = computeExpectedCash(selectedShift, report);
    const closingVal =
      selectedShift.closingCash !== null
        ? selectedShift.closingCash
        : selectedShift.id === activeShift?.id && parsedClosingCash !== null && Number.isFinite(parsedClosingCash)
          ? parsedClosingCash
          : null;
    const diffVal = closingVal !== null ? Number((closingVal - expectedCash).toFixed(2)) : null;
    const netSales = Number((report.sales.amount - report.returns.amount).toFixed(2));

    const rows = [
      {
        values: [
          'Opening Cash / الرصيد الافتتاحي',
          '—',
          formatAmount(selectedShift.openingCash),
        ],
      },
      {
        values: [
          'Gross Sales / إجمالي المبيعات',
          String(report.sales.count),
          formatAmount(report.sales.amount),
        ],
        emphasis: true,
      },
      ...report.sales.byPaymentMethod.map((item) => ({
        values: [`  • Sales (${item.paymentMethod}) / مبيعات`, String(item.count), formatAmount(item.amount)],
      })),
      {
        values: [
          'Sales Returns / مرتجعات المبيعات',
          String(report.returns.count),
          `−${formatAmount(report.returns.amount)}`,
        ],
      },
      ...report.returns.byPaymentMethod.map((item) => ({
        values: [`  • Returns (${item.paymentMethod}) / مرتجعات`, String(item.count), `−${formatAmount(item.amount)}`],
      })),
      {
        values: [
          'Cashbook In / وارد دفتر النقدية',
          String(report.cashbook.countIn),
          `+${formatAmount(report.cashbook.moneyIn)}`,
        ],
      },
      {
        values: [
          'Cashbook Out / صادر دفتر النقدية',
          String(report.cashbook.countOut),
          `−${formatAmount(report.cashbook.moneyOut)}`,
        ],
      },
      ...(report.bank.count > 0
        ? [
            {
              values: [
                'Bank In / Out / معاملات البنك',
                String(report.bank.count),
                `+${formatAmount(report.bank.moneyIn)} / −${formatAmount(report.bank.moneyOut)}`,
              ],
            },
            ...report.bank.byAccount.map((account) => ({
              values: [
                `  • ${account.accountName}`,
                String(account.count),
                `+${formatAmount(account.moneyIn)} / −${formatAmount(account.moneyOut)}`,
              ],
            })),
          ]
        : []),
    ];

    return {
      documentType: 'shift-report',
      title: 'Shift Report / تقرير الوردية',
      number: `SHIFT-${selectedShift.id}`,
      date: `${formatDate(report.from)} – ${formatDate(report.to)}`,
      companyName: settings.storeName,
      companyNameAr: settings.storeNameAr,
      companyAddress: settings.address,
      companyPhone: settings.phone,
      companyLogo: settings.storeLogoDataUrl,
      companyTaxId: settings.taxId,
      companyCrNumber: settings.crNumber,
      fields: [
        { label: 'Cashier / الكاشير', value: `${selectedShift.cashierName} (${selectedShift.cashierUsername})` },
        { label: 'Status / الحالة', value: selectedShift.closedAt ? 'Closed / مغلقة' : 'Open / مفتوحة' },
        { label: 'Opened / وقت الفتح', value: formatDate(selectedShift.openedAt) },
        { label: 'Closed / وقت الإغلاق', value: selectedShift.closedAt ? formatDate(selectedShift.closedAt) : '—' },
      ],
      columns: ['Description / البيان', 'Qty / العدد', 'Amount / المبلغ'],
      numericColumns: [1, 2],
      rows,
      totals: [
        { label: 'Total Transactions / إجمالي المعاملات', value: String(report.transactionCount) },
        { label: 'Net Sales / صافي المبيعات', value: formatAmount(netSales) },
        { label: 'Expected Cash / النقد المتوقع', value: formatAmount(expectedCash) },
        { label: 'Closing Cash / النقد الفعلي', value: closingVal === null ? '—' : formatAmount(closingVal) },
        {
          label: 'Cash Difference / الفرق النقدي',
          value: diffVal === null ? '—' : formatDifferenceLabel(diffVal, true),
        },
      ],
      footer: [settings.receiptFooter, settings.receiptFooterAr].filter(Boolean).join('\n') || [settings.phone, settings.address].filter(Boolean).join(' · '),
      direction: 'ltr',
    };
  };

  const getDailyShiftPrintData = (): PrintDocumentData => {
    if (!dailyReport) {
      throw new Error('Daily shift report is not ready to print.');
    }
    const report = dailyReport;
    const netSales = Number((report.sales.amount - report.returns.amount).toFixed(2));
    const rows = [
      {
        values: [
          'Gross Sales / إجمالي المبيعات',
          String(report.sales.count),
          formatAmount(report.sales.amount),
        ],
        emphasis: true,
      },
      ...report.sales.byPaymentMethod.map((item) => ({
        values: [`  • Sales (${item.paymentMethod}) / مبيعات`, String(item.count), formatAmount(item.amount)],
      })),
      {
        values: [
          'Sales Returns / مرتجعات المبيعات',
          String(report.returns.count),
          `−${formatAmount(report.returns.amount)}`,
        ],
      },
      ...report.returns.byPaymentMethod.map((item) => ({
        values: [`  • Returns (${item.paymentMethod}) / مرتجعات`, String(item.count), `−${formatAmount(item.amount)}`],
      })),
      {
        values: [
          'Cashbook In / وارد دفتر النقدية',
          String(report.cashbook.countIn),
          `+${formatAmount(report.cashbook.moneyIn)}`,
        ],
      },
      {
        values: [
          'Cashbook Out / صادر دفتر النقدية',
          String(report.cashbook.countOut),
          `−${formatAmount(report.cashbook.moneyOut)}`,
        ],
      },
      ...(report.bank.count > 0
        ? [
            {
              values: [
                'Bank In / Out / معاملات البنك',
                String(report.bank.count),
                `+${formatAmount(report.bank.moneyIn)} / −${formatAmount(report.bank.moneyOut)}`,
              ],
            },
            ...report.bank.byAccount.map((account) => ({
              values: [
                `  • ${account.accountName}`,
                String(account.count),
                `+${formatAmount(account.moneyIn)} / −${formatAmount(account.moneyOut)}`,
              ],
            })),
          ]
        : []),
    ];

    return {
      documentType: 'shift-report',
      title: 'Daily Counter Shift Report / تقرير الوردية اليومية',
      number: `DAILY-${dailyDate}`,
      date: `${formatDate(report.from)} – ${formatDate(report.to)}`,
      companyName: settings.storeName,
      companyNameAr: settings.storeNameAr,
      companyAddress: settings.address,
      companyPhone: settings.phone,
      companyLogo: settings.storeLogoDataUrl,
      companyTaxId: settings.taxId,
      companyCrNumber: settings.crNumber,
      fields: [
        { label: 'Mode / الوضع', value: 'Daily Auto Shift / وردية يومية تلقائية' },
        { label: 'Shift Window / فترة الوردية', value: `${dailyOpenTime} – ${dailyCloseTime}` },
        { label: 'Date / التاريخ', value: dailyDate },
      ],
      columns: ['Description / البيان', 'Qty / العدد', 'Amount / المبلغ'],
      numericColumns: [1, 2],
      rows,
      totals: [
        { label: 'Total Transactions / إجمالي المعاملات', value: String(report.transactionCount) },
        { label: 'Gross Sales / إجمالي المبيعات', value: formatAmount(report.sales.amount) },
        { label: 'Sales Returns / المرتجعات', value: `−${formatAmount(report.returns.amount)}` },
        { label: 'Net Sales / صافي المبيعات', value: formatAmount(netSales) },
      ],
      footer: [settings.receiptFooter, settings.receiptFooterAr].filter(Boolean).join('\n') || [settings.phone, settings.address].filter(Boolean).join(' · '),
      direction: 'ltr',
    };
  };

  const createDailyShiftPrintJob = async (override?: OneTimeDocumentOverride) => {
    const effective = buildEffectiveSettings(override);
    const format = getPrintDocumentFormat(effective, 'shift-report', effective.paperWidth || '80mm');
    const template = resolvePrintTemplate(
      'shift-report',
      format,
      effective.printDocumentProfiles?.['shift-report']?.[format]?.templateId
    );
    return createPrintTemplateJob(getDailyShiftPrintData(), effective, format, template.id);
  };

  const handlePrintDailyShift = async () => {
    if (!dailyReport) return;
    setPrinting(true);
    setPrintError(null);
    setPrintNotice(null);
    try {
      const job = await createDailyShiftPrintJob();
      const printed = await printTemplateJob({ ...job, silent: false });
      setPrintNotice(
        printed
          ? (isRtl ? 'تم فتح نافذة الطباعة.' : 'Print dialog opened.')
          : (isRtl ? 'تم إلغاء الطباعة.' : 'Printing was cancelled.')
      );
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : 'Could not print daily shift report.');
    } finally {
      setPrinting(false);
    }
  };

  const handleSaveDailyShiftPdf = async () => {
    if (!dailyReport) return;
    setPrinting(true);
    setPrintError(null);
    setPrintNotice(null);
    try {
      const job = await createDailyShiftPrintJob();
      const baseName = `DAILY-SHIFT_${dailyDate}`;
      const fileName = `${baseName}.pdf`;
      const titledHtml = job.html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${baseName}</title>`);
      if (window.electronAPI?.isElectron) {
        const result = await window.electronAPI.exportDesignPdf({
          fileName,
          html: titledHtml,
          pageSize: job.pageSize,
        });
        setPrintNotice(
          result.canceled
            ? (isRtl ? 'تم إلغاء حفظ ملف PDF.' : 'PDF saving was cancelled.')
            : (isRtl ? `تم حفظ ملف PDF باسم ${fileName}.` : `PDF saved as ${fileName}.`)
        );
      } else {
        const printed = await printTemplateJob({ ...job, html: titledHtml, silent: false });
        setPrintNotice(
          printed
            ? (isRtl ? `اختر حفظ كملف PDF. اسم الملف: ${fileName}` : `Choose Save as PDF. File name: ${fileName}`)
            : (isRtl ? 'تم إلغاء حفظ ملف PDF.' : 'PDF saving was cancelled.')
        );
      }
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : 'Could not save daily shift report as PDF.');
    } finally {
      setPrinting(false);
    }
  };

  const createShiftPrintJob = async (override?: OneTimeDocumentOverride) => {
    const effective = buildEffectiveSettings(override);
    const format = getPrintDocumentFormat(effective, 'shift-report', effective.paperWidth || '80mm');
    const template = resolvePrintTemplate(
      'shift-report',
      format,
      effective.printDocumentProfiles?.['shift-report']?.[format]?.templateId
    );
    return createPrintTemplateJob(getShiftPrintData(), effective, format, template.id);
  };

  const renderShiftSummary = (compact = false) => {
    if (!selectedShiftReport) return null;
    const report = selectedShiftReport;
    const rowClass = compact
      ? 'flex justify-between gap-3 border-b border-dashed border-slate-300 py-1 text-[10px]'
      : 'flex justify-between gap-3 border-b border-slate-200 py-2 text-xs';
    const headingClass = compact
      ? 'mb-1 text-xs font-bold uppercase text-slate-900'
      : 'mb-2 text-sm font-bold text-slate-900';

    return (
      <section className={compact ? 'mt-4 space-y-3 text-slate-900' : 'space-y-4'}>
        <div>
          <h3 className={headingClass}>{isRtl ? 'ملخص جميع المعاملات' : 'All Transactions Summary'}</h3>
          <div className={rowClass}>
            <span>{isRtl ? 'إجمالي عدد المعاملات' : 'Total transaction count'}</span>
            <strong>{report.transactionCount}</strong>
          </div>
          <div className={rowClass}>
            <span>{isRtl ? 'المبيعات' : 'Sales'} ({report.sales.count})</span>
            <strong>{formatAmount(report.sales.amount)}</strong>
          </div>
          <div className={rowClass}>
            <span>{isRtl ? 'المرتجعات' : 'Sales returns'} ({report.returns.count})</span>
            <strong>{formatAmount(report.returns.amount)}</strong>
          </div>
          <div className={rowClass}>
            <span>{isRtl ? 'إدخالات دفتر النقدية' : 'Cashbook entries'} ({report.cashbook.count})</span>
            <strong>
              {isRtl ? 'داخل' : 'In'} {formatAmount(report.cashbook.moneyIn)} ·{' '}
              {isRtl ? 'خارج' : 'Out'} {formatAmount(report.cashbook.moneyOut)}
            </strong>
          </div>
        </div>

        {(report.sales.byPaymentMethod.length > 0 || report.returns.byPaymentMethod.length > 0) && (
          <div>
            <h3 className={headingClass}>{isRtl ? 'المبيعات والمرتجعات حسب طريقة الدفع' : 'Sales and Returns by Payment Method'}</h3>
            {report.sales.byPaymentMethod.map((item) => (
              <div className={rowClass} key={`sale-${item.paymentMethod}`}>
                <span>{item.paymentMethod} · {isRtl ? 'مبيعات' : 'Sales'} ({item.count})</span>
                <strong>{formatAmount(item.amount)}</strong>
              </div>
            ))}
            {report.returns.byPaymentMethod.map((item) => (
              <div className={rowClass} key={`return-${item.paymentMethod}`}>
                <span>{item.paymentMethod} · {isRtl ? 'مرتجعات' : 'Returns'} ({item.count})</span>
                <strong>{formatAmount(item.amount)}</strong>
              </div>
            ))}
          </div>
        )}

        <div>
          <h3 className={headingClass}>{isRtl ? 'ملخص معاملات البنك' : 'Bank Transaction Summary'}</h3>
          <div className={rowClass}>
            <span>{isRtl ? 'إجمالي معاملات البنك' : 'Bank transaction count'} ({report.bank.count})</span>
            <strong>
              {isRtl ? 'داخل' : 'In'} {formatAmount(report.bank.moneyIn)} ·{' '}
              {isRtl ? 'خارج' : 'Out'} {formatAmount(report.bank.moneyOut)}
            </strong>
          </div>
          {report.bank.byAccount.map((account) => (
            <div className={`${rowClass} ${compact ? 'pl-2' : 'pl-3'}`} key={account.accountName}>
              <span>{account.accountName} ({account.count})</span>
              <strong>
                {isRtl ? 'داخل' : 'In'} {formatAmount(account.moneyIn)} ·{' '}
                {isRtl ? 'خارج' : 'Out'} {formatAmount(account.moneyOut)}
              </strong>
            </div>
          ))}
        </div>
      </section>
    );
  };

  const handlePrintShift = async () => {
    if (!selectedShift) return false;
    if (!selectedShiftReport || selectedShiftReport.shiftId !== selectedShift.id) {
      setPrintError(
        shiftReportLoading
          ? (isRtl ? 'جارٍ تحميل ملخص الوردية.' : 'The shift summary is still loading.')
          : (isRtl ? 'تعذر تحميل ملخص الوردية.' : 'The shift summary is unavailable.')
      );
      return false;
    }
    setPrinting(true);
    setPrintError(null);
    setPrintNotice(null);
    try {
      const job = await createShiftPrintJob();
      const printed = await printTemplateJob({ ...job, silent: false });
      setPrintNotice(
        printed
          ? (isRtl ? 'تم فتح نافذة الطباعة.' : 'Print dialog opened.')
          : (isRtl ? 'تم إلغاء الطباعة.' : 'Printing was cancelled.')
      );
      return printed;
    } catch (printFailure) {
      console.error('Failed to print shift report:', printFailure);
      setPrintError((printFailure as Error).message || 'Shift report could not be printed.');
      return false;
    } finally {
      setPrinting(false);
    }
  };

  const handleSaveShiftPdf = async () => {
    if (!selectedShift || !selectedShiftReport) return;
    setPrinting(true);
    setPrintError(null);
    setPrintNotice(null);
    try {
      const job = await createShiftPrintJob();
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const baseName = `SHIFT-${selectedShift.id}_${dateStr}`;
      const fileName = `${baseName}.pdf`;
      const titledHtml = job.html.replace(
        /<title>[\s\S]*?<\/title>/i,
        `<title>${baseName}</title>`
      );
      if (window.electronAPI?.isElectron) {
        const result = await window.electronAPI.exportDesignPdf({
          fileName,
          html: titledHtml,
          pageSize: job.pageSize,
        });
        setPrintNotice(
          result.canceled
            ? (isRtl ? 'تم إلغاء حفظ ملف PDF.' : 'PDF saving was cancelled.')
            : (isRtl ? `تم حفظ ملف PDF باسم ${fileName}.` : `PDF saved as ${fileName}.`)
        );
      } else {
        const printed = await printTemplateJob({ ...job, html: titledHtml, silent: false });
        setPrintNotice(
          printed
            ? (isRtl ? `اختر حفظ كملف PDF. اسم الملف: ${fileName}` : `Choose Save as PDF. File name: ${fileName}`)
            : (isRtl ? 'تم إلغاء حفظ ملف PDF.' : 'PDF saving was cancelled.')
        );
      }
    } catch (pdfError) {
      setPrintError(
        pdfError instanceof Error
          ? pdfError.message
          : (isRtl ? 'تعذر حفظ تقرير الوردية بصيغة PDF.' : 'Could not save shift report as PDF.')
      );
    } finally {
      setPrinting(false);
    }
  };

  return (
    <main
      className="pos-app-shell min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-6"
      data-theme={theme}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              {isRtl ? 'فتح وإغلاق الوردية' : 'Shift Opening & Closing'}
            </h1>
            <p className="text-xs text-slate-500">
              {isRtl ? 'الكاشير:' : 'Cashier:'} {cashierName}
            </p>
          </div>
        </header>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {isDailyCounterShift ? (
          <section className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-emerald-800">
                    {isRtl ? 'وردية الصندوق اليومية التلقائية' : 'Daily Counter Shift (Automatic)'}
                  </h2>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-800">
                    {dailyOpenTime} – {dailyCloseTime}
                    {dailyCloseNextDay ? (isRtl ? ' (اليوم التالي)' : ' (Next Day)') : ''}
                    {dailyShiftDurationLabel ? ` · ${dailyShiftDurationLabel}` : ''}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {isRtl
                    ? 'يتم حساب جميع السندات تلقائياً ضمن وقت الفتح والإغلاق اليومي دون فتح أو إغلاق يدوي.'
                    : 'All entries within the configured daily opening & closing times are calculated automatically without manual open/close balances.'}
                </p>
              </div>
              <label className="text-xs font-semibold text-slate-700">
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
                  {isRtl ? 'تاريخ الوردية' : 'Shift Date'}
                </span>
                <input
                  type="date"
                  value={dailyDate}
                  onChange={(e) => setDailyDate(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-emerald-600 focus:outline-none"
                />
              </label>
            </div>

            {printError && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {printError}
              </div>
            )}
            {printNotice && (
              <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {printNotice}
              </div>
            )}
            {dailyError && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {dailyError}
              </div>
            )}

            {dailyLoading ? (
              <p className="py-6 text-center text-xs text-slate-500">
                {isRtl ? 'جارٍ حساب تقرير الوردية اليومية...' : 'Calculating daily counter shift...'}
              </p>
            ) : dailyReport ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {isRtl ? 'المعاملات' : 'Transactions'}
                    </p>
                    <p className="mt-1 font-mono text-base font-bold text-slate-900">
                      {dailyReport.transactionCount}
                    </p>
                  </article>
                  <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {isRtl ? 'إجمالي المبيعات' : 'Gross Sales'}
                    </p>
                    <p className="mt-1 font-mono text-sm font-bold text-slate-900">
                      {formatAmount(dailyReport.sales.amount)}
                    </p>
                  </article>
                  <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {isRtl ? 'المرتجعات' : 'Returns'}
                    </p>
                    <p className="mt-1 font-mono text-sm font-bold text-red-700">
                      −{formatAmount(dailyReport.returns.amount)}
                    </p>
                  </article>
                  <article className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                      {isRtl ? 'صافي المبيعات' : 'Net Sales'}
                    </p>
                    <p className="mt-1 font-mono text-sm font-extrabold text-emerald-800">
                      {formatAmount(dailyReport.sales.amount - dailyReport.returns.amount)}
                    </p>
                  </article>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-3 space-y-1.5 text-xs">
                    <h3 className="font-bold text-slate-900">
                      {isRtl ? 'حسب طريقة الدفع' : 'By Payment Method'}
                    </h3>
                    {dailyReport.sales.byPaymentMethod.length === 0 ? (
                      <p className="text-slate-400">{isRtl ? 'لا توجد مبيعات في هذه الفترة.' : 'No sales in this window.'}</p>
                    ) : (
                      dailyReport.sales.byPaymentMethod.map((item) => (
                        <div key={`daily-sale-${item.paymentMethod}`} className="flex justify-between border-b border-slate-100 py-1">
                          <span>{item.paymentMethod} ({item.count})</span>
                          <strong className="font-mono">{formatAmount(item.amount)}</strong>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3 space-y-1.5 text-xs">
                    <h3 className="font-bold text-slate-900">
                      {isRtl ? 'دفتر النقدية والبنك' : 'Cashbook & Bank'}
                    </h3>
                    <div className="flex justify-between border-b border-slate-100 py-1">
                      <span>{isRtl ? 'دفتر النقدية' : 'Cashbook'} ({dailyReport.cashbook.count})</span>
                      <strong className="font-mono">
                        +{formatAmount(dailyReport.cashbook.moneyIn)} / −{formatAmount(dailyReport.cashbook.moneyOut)}
                      </strong>
                    </div>
                    <div className="flex justify-between py-1">
                      <span>{isRtl ? 'البنك' : 'Bank'} ({dailyReport.bank.count})</span>
                      <strong className="font-mono">
                        +{formatAmount(dailyReport.bank.moneyIn)} / −{formatAmount(dailyReport.bank.moneyOut)}
                      </strong>
                    </div>
                  </div>
                </div>

                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={printing}
                      onClick={() => setShowDailyTemplateModal(true)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 underline-offset-4 hover:text-emerald-800 hover:underline disabled:opacity-50"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      <span>{isRtl ? 'اختيار القوالب' : 'Choose Templates'}</span>
                      {oneTimeOverrides['shift-report'] && (
                        <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 no-underline">
                          {isRtl ? 'مخصص' : 'Custom'}
                        </span>
                      )}
                    </button>
                    <span className="text-slate-300" aria-hidden="true">|</span>
                    <button
                      type="button"
                      disabled={printing}
                      onClick={() => void handleSaveDailyShiftPdf()}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 underline-offset-4 hover:text-emerald-800 hover:underline disabled:opacity-50"
                    >
                      {printing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      <span>{isRtl ? 'حفظ كـ PDF' : 'Save as PDF'}</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={printing}
                    onClick={() => void handlePrintDailyShift()}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                  >
                    {printing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
                    <span>{isRtl ? 'طباعة التقرير اليومي' : 'Print Daily Report'}</span>
                  </button>
                </footer>
              </div>
            ) : null}

            {showDailyTemplateModal && dailyReport && (
              <OneTimeTemplateModal
                settings={settings}
                defaultFormatFallback={activeFormat}
                documents={[{ id: 'shift-report', label: isRtl ? 'تقرير الوردية اليومية' : 'Daily Shift Report' }]}
                initialDocument="shift-report"
                overrides={oneTimeOverrides}
                onBuildPreviewJob={(_docType, override) => createDailyShiftPrintJob(override)}
                onApply={(next) => setOneTimeOverrides({ 'shift-report': next['shift-report'] })}
                onClose={() => setShowDailyTemplateModal(false)}
              />
            )}
          </section>
        ) : loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            {isRtl ? 'جارٍ تحميل الورديات...' : 'Loading shifts...'}
          </div>
        ) : activeShift ? (
          <section className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                  <UnlockKeyhole className="h-4 w-4" />
                  {isRtl ? 'الوردية مفتوحة' : 'Shift is open'}
                </h2>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                  <Clock3 className="h-3.5 w-3.5" />
                  {formatDate(activeShift.openedAt)}
                </p>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-medium text-slate-500">
                  {isRtl ? 'الرصيد الافتتاحي' : 'Opening cash'}
                </div>
                <div className="font-mono text-lg font-bold text-slate-900">
                  {formatAmount(activeShift.openingCash)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedShift(activeShift);
                  setPrintError(null);
                  setPrintNotice(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <FileText className="h-3.5 w-3.5" />
                {isRtl ? 'تفاصيل الوردية' : 'Shift details'}
              </button>
            </div>

            <form onSubmit={handleCloseShift} className="space-y-3 border-t border-slate-100 pt-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label htmlFor="shift-closing-cash" className="mb-1 block text-xs font-semibold text-slate-700">
                    {isRtl ? 'النقد الفعلي عند الإغلاق' : 'Counted cash at closing'}
                  </label>
                  <input
                    id="shift-closing-cash"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={closingCash}
                    onChange={(event) => setClosingCash(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <button
                  type="submit"
                  disabled={saving !== null}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-900 disabled:cursor-wait disabled:opacity-60"
                >
                  <LockKeyhole className="h-4 w-4" />
                  {saving === 'close'
                    ? (isRtl ? 'جارٍ إغلاق الوردية...' : 'Closing shift...')
                    : (isRtl ? 'إغلاق الوردية' : 'Close Shift')}
                </button>
              </div>

              {/* Live Cash Reconciliation & Difference Strip */}
              <div className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3 sm:grid-cols-3">
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {isRtl ? 'النقد المتوقع' : 'Expected Cash'}
                  </span>
                  <span className="mt-0.5 block font-mono text-sm font-bold text-slate-900">
                    {formatAmount(activeExpectedCash)}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {isRtl ? 'النقد الفعلي' : 'Counted Closing'}
                  </span>
                  <span className="mt-0.5 block font-mono text-sm font-bold text-slate-900">
                    {parsedClosingCash !== null && Number.isFinite(parsedClosingCash)
                      ? formatAmount(parsedClosingCash)
                      : '—'}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {isRtl ? 'الفرق النقدي' : 'Difference'}
                  </span>
                  <span
                    className={`mt-0.5 block font-mono text-sm font-extrabold ${
                      activeClosingDifference === null
                        ? 'text-slate-400'
                        : Math.abs(activeClosingDifference) < 0.005
                          ? 'text-emerald-700'
                          : activeClosingDifference > 0
                            ? 'text-blue-700'
                            : 'text-red-600'
                    }`}
                  >
                    {activeClosingDifference === null
                      ? '—'
                      : formatDifferenceLabel(activeClosingDifference)}
                  </span>
                </div>
              </div>
            </form>
          </section>
        ) : (
          <section className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4">
              <h2 className="flex items-center gap-2 text-sm font-bold text-blue-800">
                <UnlockKeyhole className="h-4 w-4" />
                {isRtl ? 'بدء وردية جديدة' : 'Open a new shift'}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {isRtl ? 'سجّل المبلغ النقدي الموجود في الدرج عند بداية الوردية.' : 'Record the cash in the drawer at the start of the shift.'}
              </p>
            </div>
            <form onSubmit={handleOpenShift} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="shift-opening-cash" className="mb-1 block text-xs font-semibold text-slate-700">
                  {isRtl ? 'الرصيد الافتتاحي النقدي' : 'Opening cash balance'}
                </label>
                <input
                  id="shift-opening-cash"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={openingCash}
                  onChange={(event) => setOpeningCash(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <button
                type="submit"
                disabled={saving !== null}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
              >
                <UnlockKeyhole className="h-4 w-4" />
                {saving === 'open'
                  ? (isRtl ? 'جارٍ فتح الوردية...' : 'Opening shift...')
                  : (isRtl ? 'فتح الوردية' : 'Open Shift')}
              </button>
            </form>
          </section>
        )}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-bold text-slate-800">
              {isRtl ? 'الورديات السابقة' : 'Recent shifts'}
            </h2>
          </div>
          {shiftHistory.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              {isRtl ? 'لا توجد ورديات مغلقة بعد.' : 'No closed shifts yet.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">{isRtl ? 'بداية الوردية' : 'Opened'}</th>
                    <th className="px-4 py-2.5 font-semibold">{isRtl ? 'نهاية الوردية' : 'Closed'}</th>
                    <th className="px-4 py-2.5 text-right font-semibold">{isRtl ? 'الرصيد الافتتاحي' : 'Opening cash'}</th>
                    <th className="px-4 py-2.5 text-right font-semibold">{isRtl ? 'الرصيد الختامي' : 'Closing cash'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shiftHistory.map((shift) => (
                    <tr
                      key={shift.id}
                      role="button"
                      tabIndex={0}
                      aria-haspopup="dialog"
                      aria-label={`${isRtl ? 'تفاصيل الوردية' : 'Shift details'} ${shift.id}`}
                      onClick={() => {
                        setSelectedShift(shift);
                        setPrintError(null);
                        setPrintNotice(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedShift(shift);
                          setPrintError(null);
                          setPrintNotice(null);
                        }
                      }}
                      className="cursor-pointer outline-none hover:bg-blue-50 focus-visible:bg-blue-50"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDate(shift.openedAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                        {shift.closedAt ? formatDate(shift.closedAt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-700">
                        {formatAmount(shift.openingCash)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-700">
                        {shift.closingCash === null ? '—' : formatAmount(shift.closingCash)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {confirmationAction && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shift-password-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setConfirmationAction(null);
              setConfirmationPassword('');
              setConfirmationError(null);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && saving === null) {
              event.preventDefault();
              setConfirmationAction(null);
              setConfirmationPassword('');
              setConfirmationError(null);
            }
          }}
        >
          <section className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <h2 id="shift-password-title" className="text-sm font-bold text-slate-900">
                  {confirmationAction === 'open'
                    ? (isRtl ? 'تأكيد فتح الوردية' : 'Confirm opening shift')
                    : (isRtl ? 'تأكيد إغلاق الوردية' : 'Confirm closing shift')}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {isRtl
                    ? `أدخل كلمة مرور المستخدم ${cashierUsername} للمتابعة.`
                    : `Enter ${cashierUsername}'s current password to continue.`}
                </p>
              </div>
            </header>
            <form onSubmit={handleConfirmShiftAction} className="space-y-4 p-5">
              <div>
                <label htmlFor="shift-confirm-password" className="mb-1.5 block text-xs font-semibold text-slate-700">
                  {isRtl ? 'كلمة المرور الحالية' : 'Current password'}
                </label>
                <input
                  id="shift-confirm-password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  required
                  value={confirmationPassword}
                  onChange={(event) => setConfirmationPassword(event.target.value)}
                  aria-describedby={confirmationError ? 'shift-password-error' : undefined}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
              {confirmationError && (
                <p id="shift-password-error" role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {confirmationError}
                </p>
              )}
              <footer className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={saving !== null}
                  onClick={() => {
                    setConfirmationAction(null);
                    setConfirmationPassword('');
                    setConfirmationError(null);
                  }}
                  className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {isRtl ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={saving !== null || !confirmationPassword}
                  className="rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
                >
                  {saving
                    ? (isRtl ? 'جارٍ التحقق...' : 'Verifying...')
                    : (isRtl ? 'تأكيد' : 'Confirm')}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {selectedShift && (
        <div
          className="shift-report-modal fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shift-details-title"
          onClick={(event) => {
            if (event.target === event.currentTarget && !showTemplateModal) setSelectedShift(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !showTemplateModal) {
              event.preventDefault();
              setSelectedShift(null);
            }
          }}
        >
          <section className="shift-report-dialog pos-app-shell flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <header className="no-print flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 id="shift-details-title" className="text-base font-bold text-slate-900">
                    {isRtl ? `تقرير الوردية #${selectedShift.id}` : `Shift Report #${selectedShift.id}`}
                  </h2>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      selectedShift.closedAt
                        ? 'bg-slate-200 text-slate-700'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {selectedShift.closedAt
                      ? (isRtl ? 'مغلقة' : 'Closed')
                      : (isRtl ? 'مفتوحة' : 'Open')}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {selectedShift.cashierName} ({selectedShift.cashierUsername}) · {formatDate(selectedShift.openedAt)}
                  {selectedShift.closedAt ? ` → ${formatDate(selectedShift.closedAt)}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedShift(null)}
                autoFocus
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200/70 hover:text-slate-800"
                aria-label={isRtl ? 'إغلاق' : 'Close'}
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="no-print min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              {printError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {printError}
                </div>
              )}
              {printNotice && (
                <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  {printNotice}
                </div>
              )}

              {/* Cash Reconciliation 4-Card KPI Strip */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {isRtl ? 'الافتتاحي' : 'Opening'}
                  </p>
                  <p className="mt-1 font-mono text-sm font-bold text-slate-900">
                    {formatAmount(selectedShift.openingCash)}
                  </p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {isRtl ? 'النقد المتوقع' : 'Expected'}
                  </p>
                  <p className="mt-1 font-mono text-sm font-bold text-slate-900">
                    {formatAmount(selectedExpectedCash)}
                  </p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {isRtl ? 'الختامي' : 'Closing'}
                  </p>
                  <p className="mt-1 font-mono text-sm font-bold text-slate-900">
                    {selectedClosingValue === null ? '—' : formatAmount(selectedClosingValue)}
                  </p>
                </article>
                <article
                  className={`rounded-xl border p-3 ${
                    selectedDifference === null
                      ? 'border-slate-200 bg-slate-50'
                      : Math.abs(selectedDifference) < 0.005
                        ? 'border-emerald-200 bg-emerald-50/70'
                        : selectedDifference > 0
                          ? 'border-blue-200 bg-blue-50/70'
                          : 'border-red-200 bg-red-50/70'
                  }`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    {isRtl ? 'الفرق' : 'Difference'}
                  </p>
                  <p
                    className={`mt-1 font-mono text-xs font-extrabold ${
                      selectedDifference === null
                        ? 'text-slate-400'
                        : Math.abs(selectedDifference) < 0.005
                          ? 'text-emerald-800'
                          : selectedDifference > 0
                            ? 'text-blue-800'
                            : 'text-red-700'
                    }`}
                  >
                    {selectedDifference === null ? '—' : formatDifferenceLabel(selectedDifference)}
                  </p>
                </article>
              </div>

              {shiftReportLoading && (
                <p className="text-center text-xs text-slate-500">
                  {isRtl ? 'جارٍ تحميل ملخص المعاملات...' : 'Loading transaction summary...'}
                </p>
              )}
              {shiftReportError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {shiftReportError}
                </div>
              )}
              {renderShiftSummary()}
            </div>

            <footer className="no-print flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-5 py-3.5">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={printing || shiftReportLoading || !selectedShiftReport}
                  onClick={() => setShowTemplateModal(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 underline-offset-4 hover:text-emerald-800 hover:underline disabled:opacity-50"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>{isRtl ? 'اختيار القوالب' : 'Choose Templates'}</span>
                  {oneTimeOverrides['shift-report'] && (
                    <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 no-underline">
                      {isRtl ? 'مخصص' : 'Custom'}
                    </span>
                  )}
                </button>
                <span className="text-slate-300" aria-hidden="true">|</span>
                <button
                  type="button"
                  disabled={printing || shiftReportLoading || !selectedShiftReport}
                  onClick={() => void handleSaveShiftPdf()}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 underline-offset-4 hover:text-emerald-800 hover:underline disabled:opacity-50"
                >
                  {printing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  <span>{isRtl ? 'حفظ كـ PDF' : 'Save as PDF'}</span>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedShift(null)}
                  className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {isRtl ? 'إغلاق' : 'Close'}
                </button>
                <button
                  type="button"
                  onClick={() => void handlePrintShift()}
                  disabled={printing || shiftReportLoading || !selectedShiftReport}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60"
                >
                  {printing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
                  {printing
                    ? (isRtl ? 'جارٍ الطباعة...' : 'Printing...')
                    : (isRtl ? 'طباعة التقرير' : 'Print Report')}
                </button>
              </div>
            </footer>
          </section>

          {showTemplateModal && selectedShiftReport && (
            <OneTimeTemplateModal
              settings={settings}
              defaultFormatFallback={activeFormat}
              documents={[{ id: 'shift-report', label: isRtl ? 'تقرير الوردية' : 'Shift Report' }]}
              initialDocument="shift-report"
              overrides={oneTimeOverrides}
              onBuildPreviewJob={(_docType, override) => createShiftPrintJob(override)}
              onApply={(next) => setOneTimeOverrides({ 'shift-report': next['shift-report'] })}
              onClose={() => setShowTemplateModal(false)}
            />
          )}
        </div>
      )}
    </main>
  );
};
