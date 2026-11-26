import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Receipt,
  Wallet,
} from 'lucide-react';
import type {
  CashbookEntry,
  CashbookOpeningBalance,
  CreateCashbookEntryInput,
  PaperWidth,
  PurchaseEntry,
  Sale,
  SalesReturnVoucher,
  StoreSettings,
} from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import {
  getInvoiceDateTime,
  matchesDateBounds,
  resolveDateBounds,
  toLocalDateKey,
  type DateFilter,
} from '../utils/dateFilters';
import { getPaymentMethods } from '../utils/paymentMethods';
import { createPrintTemplateJob, printTemplateJob } from '../printTemplates/render';
import { resolvePrintTemplate } from '../printTemplates/catalog';
import type { PrintDocumentData } from '../printTemplates/types';

type ReportTab = 'DAILY_SUMMARY' | 'DETAILED_SALES' | 'DATEWISE_SUMMARY' | 'TAX' | 'SALES_TAX' | 'CASHBOOK';

interface ReportsViewProps {
  mode: 'reports' | 'cashbook';
  sales: Sale[];
  returnVouchers: SalesReturnVoucher[];
  purchases: PurchaseEntry[];
  cashbookEntries: CashbookEntry[];
  cashbookOpeningBalance: CashbookOpeningBalance | null;
  canManageCashbook: boolean;
  accountOptions?: string[];
  onCreateCashbookEntry: (
    input: Omit<CreateCashbookEntryInput, 'createdBy'>
  ) => Promise<void>;
  settings: StoreSettings;
}

interface CashMovement {
  date: string;
  direction: 'IN' | 'OUT';
  source: string;
  description: string;
  reference: string;
  amount: number;
  createdBy: string;
}

interface DailyCashSummary {
  date: string;
  cashSales: number;
  cashRefunds: number;
  manualIn: number;
  manualOut: number;
  netBalance: number;
  openingBalance: number | null;
  closingBalance: number | null;
}

interface LedgerLine {
  date: string;
  particulars: string;
  amount: number;
}

const dateKeyFor = (value: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : toLocalDateKey(date);
};

const isDateInBounds = (date: string, bounds: ReturnType<typeof resolveDateBounds>) =>
  Boolean(date) && (!bounds.start || date >= bounds.start) && (!bounds.end || date <= bounds.end);

const shiftDateKey = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const ReportsView: React.FC<ReportsViewProps> = ({
  mode,
  sales,
  returnVouchers,
  purchases,
  cashbookEntries,
  cashbookOpeningBalance,
  canManageCashbook,
  accountOptions = [],
  onCreateCashbookEntry,
  settings,
}) => {
  const { isRtl } = useLanguage();
  const [activeReport, setActiveReport] = useState<ReportTab>(
    mode === 'cashbook' ? 'CASHBOOK' : 'DAILY_SUMMARY'
  );
  const [dateFilter, setDateFilter] = useState<DateFilter>(
    mode === 'cashbook' ? 'ALL' : 'TODAY'
  );
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedDay, setSelectedDay] = useState(toLocalDateKey(new Date()));
  const [salesPaymentFilter, setSalesPaymentFilter] = useState('ALL');
  const [salesCustomerFilter, setSalesCustomerFilter] = useState('ALL');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [entryDate, setEntryDate] = useState(toLocalDateKey(new Date()));
  const [entryDirection, setEntryDirection] = useState<'IN' | 'OUT'>('IN');
  const [entryPaymentType, setEntryPaymentType] = useState<'CASH' | 'BANK'>('CASH');
  const [entryAccount, setEntryAccount] = useState('Cash');
  const [entryDescription, setEntryDescription] = useState('');
  const [entryAmount, setEntryAmount] = useState('');
  const [entryReference, setEntryReference] = useState('');
  const [cashbookError, setCashbookError] = useState<string | null>(null);
  const [savingCashbook, setSavingCashbook] = useState(false);
  const currency = isRtl ? 'ر.س ' : settings.currencySymbol || 'SAR ';
  const isSingleDaySummary = mode === 'reports' && activeReport === 'DAILY_SUMMARY';
  const dateBounds = useMemo(
    () => isSingleDaySummary
      ? { start: selectedDay, end: selectedDay }
      : resolveDateBounds(dateFilter, dateFrom, dateTo),
    [dateFilter, dateFrom, dateTo, isSingleDaySummary, selectedDay]
  );
  const completedSales = useMemo(
    () =>
      sales.filter(
        (sale) =>
          sale.status === 'COMPLETED' &&
          matchesDateBounds(sale.invoiceDate || sale.createdAt, dateBounds)
      ),
    [sales, dateBounds]
  );
  const detailedSalesPaymentOptions = useMemo(
    () => getPaymentMethods([
      ...(settings.paymentMethods || []),
      ...sales.map((sale) => sale.paymentMethod),
    ]),
    [sales, settings.paymentMethods]
  );
  const detailedSalesCustomerOptions = useMemo(
    () => Array.from(
      new Set(sales.filter((sale) => sale.status === 'COMPLETED').map((sale) => sale.customerName).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b)),
    [sales]
  );
  const filteredDetailedSales = useMemo(
    () => completedSales.filter((sale) =>
      (salesPaymentFilter === 'ALL' || sale.paymentMethod === salesPaymentFilter) &&
      (salesCustomerFilter === 'ALL' || sale.customerName === salesCustomerFilter)
    ),
    [completedSales, salesPaymentFilter, salesCustomerFilter]
  );
  const detailedSalesTotals = useMemo(
    () => filteredDetailedSales.reduce(
      (totals, sale) => ({
        total: totals.total + sale.total,
        discount: totals.discount + sale.discountAmount,
        tax: totals.tax + sale.taxAmount,
      }),
      { total: 0, discount: 0, tax: 0 }
    ),
    [filteredDetailedSales]
  );
  const filteredReturns = useMemo(
    () => returnVouchers.filter((voucher) => isDateInBounds(dateKeyFor(voucher.createdAt), dateBounds)),
    [returnVouchers, dateBounds]
  );
  const filteredPurchases = useMemo(
    () => purchases.filter((purchase) => isDateInBounds(dateKeyFor(purchase.receivedDate || purchase.createdAt), dateBounds)),
    [purchases, dateBounds]
  );
  const filteredCashbookEntries = useMemo(
    () => cashbookEntries.filter((entry) => isDateInBounds(entry.entryDate, dateBounds)),
    [cashbookEntries, dateBounds]
  );
  const firstCashActivityDate = useMemo(
    () =>
      [
        ...sales
          .filter((sale) => sale.status === 'COMPLETED' && sale.paymentMethod === 'Cash')
          .map((sale) => dateKeyFor(sale.invoiceDate || sale.createdAt)),
        ...returnVouchers
          .filter((voucher) => voucher.paymentMethod === 'Cash')
          .map((voucher) => dateKeyFor(voucher.createdAt)),
        ...cashbookEntries.map((entry) => entry.entryDate),
      ]
        .filter(Boolean)
        .sort()[0] || null,
    [sales, returnVouchers, cashbookEntries]
  );
  const openingBalanceIsInitial = Boolean(
    cashbookOpeningBalance &&
      (!firstCashActivityDate || cashbookOpeningBalance.entryDate <= firstCashActivityDate)
  );

  const cashMovements = useMemo<CashMovement[]>(() => {
    const movements: CashMovement[] = [];
    for (const sale of completedSales) {
      if (sale.paymentMethod === 'Cash') {
        movements.push({
          date: dateKeyFor(sale.invoiceDate || sale.createdAt),
          direction: 'IN',
          source: 'Cash sale',
          description: `Cash sale ${sale.receiptNumber}`,
          reference: sale.receiptNumber,
          amount: sale.total,
          createdBy: sale.cashierName,
        });
      }
    }
    for (const voucher of filteredReturns) {
      if (voucher.paymentMethod === 'Cash') {
        movements.push({
          date: dateKeyFor(voucher.createdAt),
          direction: 'OUT',
          source: 'Cash refund',
          description: `Refund ${voucher.voucherNumber}`,
          reference: voucher.voucherNumber,
          amount: voucher.refundAmount,
          createdBy: voucher.cashierName,
        });
      }
    }
    for (const entry of filteredCashbookEntries) {
      movements.push({
        date: entry.entryDate,
        direction: entry.direction,
        source: 'Manual',
        description: `${entry.category}: ${entry.description}`,
        reference: entry.reference,
        amount: entry.amount,
        createdBy: entry.createdBy,
      });
    }
    return movements.sort((a, b) => b.date.localeCompare(a.date));
  }, [completedSales, filteredReturns, filteredCashbookEntries]);

  const cashbookTransactions = useMemo(
    () => filteredCashbookEntries
      .map((entry) => ({
        date: entry.entryDate,
        direction: entry.direction,
        category: entry.category,
        paymentType: entry.paymentType,
        accountName: entry.accountName,
        description: entry.description,
        reference: entry.reference,
        amount: entry.amount,
        createdBy: entry.createdBy,
      }))
      .sort((a, b) => b.date.localeCompare(a.date)),
    [filteredCashbookEntries]
  );
  const cashbookEntryTotals = useMemo(
    () => cashbookTransactions.reduce(
      (totals, transaction) => {
        if (transaction.direction === 'IN') totals.cashIn += transaction.amount;
        else totals.cashOut += transaction.amount;
        return totals;
      },
      { cashIn: 0, cashOut: 0 }
    ),
    [cashbookTransactions]
  );

  const dailyCashRows = useMemo<DailyCashSummary[]>(() => {
    const eventKeys = [
      ...completedSales.map((sale) => dateKeyFor(sale.invoiceDate || sale.createdAt)),
      ...filteredReturns.map((voucher) => dateKeyFor(voucher.createdAt)),
      ...filteredCashbookEntries.map((entry) => entry.entryDate),
    ].filter(Boolean);
    const today = toLocalDateKey(new Date());
    const balanceStart = openingBalanceIsInitial ? cashbookOpeningBalance?.entryDate : undefined;
    const dataStart = [...eventKeys, balanceStart || '']
      .filter(Boolean)
      .sort()[0] || today;
    const start = dateBounds.start || dataStart;
    const end = dateBounds.end || today;
    if (start > end) return [];

    const movementByDate = new Map<string, CashMovement[]>();
    for (const movement of cashMovements) {
      const current = movementByDate.get(movement.date) || [];
      current.push(movement);
      movementByDate.set(movement.date, current);
    }

    const priorCashNet = (notBeforeDate?: string) => {
      const inPriorPeriod = (date: string) =>
        Boolean(date) && date < start && (!notBeforeDate || date >= notBeforeDate);
      const priorCashSales = sales
        .filter((sale) => {
          const date = dateKeyFor(sale.invoiceDate || sale.createdAt);
          return sale.status === 'COMPLETED' && sale.paymentMethod === 'Cash' && inPriorPeriod(date);
        })
        .reduce((sum, sale) => sum + sale.total, 0);
      const priorCashRefunds = returnVouchers
        .filter((voucher) => {
          const date = dateKeyFor(voucher.createdAt);
          return voucher.paymentMethod === 'Cash' && inPriorPeriod(date);
        })
        .reduce((sum, voucher) => sum + voucher.refundAmount, 0);
      const priorManualNet = cashbookEntries
        .filter((entry) => inPriorPeriod(entry.entryDate))
        .reduce(
          (sum, entry) => sum + (entry.direction === 'IN' ? entry.amount : -entry.amount),
          0
        );
      return priorCashSales - priorCashRefunds + priorManualNet;
    };
    let runningBalance = cashbookOpeningBalance && balanceStart === start
        ? cashbookOpeningBalance.amount
        : cashbookOpeningBalance && balanceStart && balanceStart < start
          ? cashbookOpeningBalance.amount + priorCashNet(balanceStart)
          : priorCashNet();
    const output: DailyCashSummary[] = [];
    const dayCount = Math.min(
      20000,
      Math.max(0, Math.round(
        (new Date(`${end}T00:00:00.000Z`).getTime() -
          new Date(`${start}T00:00:00.000Z`).getTime()) / 86400000
      ) + 1)
    );

    for (let offset = 0; offset < dayCount; offset += 1) {
      const date = shiftDateKey(start, offset);
      const rows = movementByDate.get(date) || [];
      const cashSales = rows
        .filter((row) => row.source === 'Cash sale')
        .reduce((sum, row) => sum + row.amount, 0);
      const cashRefunds = rows
        .filter((row) => row.source === 'Cash refund')
        .reduce((sum, row) => sum + row.amount, 0);
      const manualIn = rows
        .filter((row) => row.source === 'Manual' && row.direction === 'IN')
        .reduce((sum, row) => sum + row.amount, 0);
      const manualOut = rows
        .filter((row) => row.source === 'Manual' && row.direction === 'OUT')
        .reduce((sum, row) => sum + row.amount, 0);
      const daily = {
        date,
        cashSales,
        cashRefunds,
        manualIn,
        manualOut,
        netBalance: cashSales - cashRefunds + manualIn - manualOut,
        openingBalance: null as number | null,
        closingBalance: null as number | null,
      };

      if (balanceStart && date >= balanceStart) {
        if (date === balanceStart) runningBalance = cashbookOpeningBalance?.amount ?? 0;
        daily.openingBalance = runningBalance;
        runningBalance += daily.netBalance;
        daily.closingBalance = runningBalance;
      } else {
        daily.openingBalance = runningBalance;
        runningBalance += daily.netBalance;
        daily.closingBalance = runningBalance;
      }
      output.push(daily);
    }
    return output;
  }, [
    completedSales,
    filteredReturns,
    filteredCashbookEntries,
    cashbookOpeningBalance,
    openingBalanceIsInitial,
    sales,
    returnVouchers,
    cashbookEntries,
    dateBounds,
    cashMovements,
  ]);

  const salesTotal = completedSales.reduce((sum, sale) => sum + sale.total, 0);
  const discountsTotal = completedSales.reduce((sum, sale) => sum + sale.discountAmount, 0);
  const salesTaxTotal = completedSales.reduce((sum, sale) => sum + sale.taxAmount, 0);
  const returnsTotal = filteredReturns.reduce((sum, voucher) => sum + voucher.refundAmount, 0);
  const returnedTaxTotal = filteredReturns.reduce(
    (sum, voucher) => sum + voucher.taxRefundAmount,
    0
  );
  const netSalesTotal = salesTotal - returnsTotal;

  const paymentRows = useMemo(() => {
    const groups = new Map<string, { transactions: number; total: number; tax: number }>();
    for (const sale of completedSales) {
      const current = groups.get(sale.paymentMethod) || { transactions: 0, total: 0, tax: 0 };
      current.transactions += 1;
      current.total += sale.total;
      current.tax += sale.taxAmount;
      groups.set(sale.paymentMethod, current);
    }
    return Array.from(groups, ([method, values]) => ({ method, ...values })).sort(
      (a, b) => b.total - a.total
    );
  }, [completedSales]);

  const cashierRows = useMemo(() => {
    const groups = new Map<string, { transactions: number; total: number; tax: number }>();
    for (const sale of completedSales) {
      const current = groups.get(sale.cashierName) || { transactions: 0, total: 0, tax: 0 };
      current.transactions += 1;
      current.total += sale.total;
      current.tax += sale.taxAmount;
      groups.set(sale.cashierName, current);
    }
    return Array.from(groups, ([cashier, values]) => ({ cashier, ...values })).sort(
      (a, b) => b.total - a.total
    );
  }, [completedSales]);

  const productRows = useMemo(() => {
    const groups = new Map<
      string,
      { sku: string; product: string; sold: number; returned: number; gross: number; refund: number }
    >();
    for (const sale of completedSales) {
      for (const item of sale.items) {
        const key = `${item.sku}:${item.productName}`;
        const current = groups.get(key) || {
          sku: item.sku,
          product: item.productName,
          sold: 0,
          returned: 0,
          gross: 0,
          refund: 0,
        };
        current.sold += item.quantity;
        current.gross += item.lineTotal;
        groups.set(key, current);
      }
    }
    for (const voucher of filteredReturns) {
      for (const item of voucher.items) {
        const key = `${item.sku}:${item.productName}`;
        const current = groups.get(key) || {
          sku: item.sku,
          product: item.productName,
          sold: 0,
          returned: 0,
          gross: 0,
          refund: 0,
        };
        current.returned += item.quantity;
        current.refund += item.refundAmount;
        groups.set(key, current);
      }
    }
    return Array.from(groups.values()).sort((a, b) => b.gross - a.gross);
  }, [completedSales, filteredReturns]);

  const taxRows = useMemo(() => {
    const days = new Map<string, { collected: number; refunded: number }>();
    for (const sale of completedSales) {
      const day = dateKeyFor(sale.invoiceDate || sale.createdAt);
      const row = days.get(day) || { collected: 0, refunded: 0 };
      row.collected += sale.taxAmount;
      days.set(day, row);
    }
    for (const voucher of filteredReturns) {
      const day = toLocalDateKey(new Date(voucher.createdAt));
      const row = days.get(day) || { collected: 0, refunded: 0 };
      row.refunded += voucher.taxRefundAmount;
      days.set(day, row);
    }
    return Array.from(days, ([date, amounts]) => ({
      date,
      ...amounts,
      net: amounts.collected - amounts.refunded,
    })).sort((a, b) => b.date.localeCompare(a.date));
  }, [completedSales, filteredReturns]);

  const cashbookTotals = useMemo(() => ({
    cashSales: cashMovements
      .filter((movement) => movement.source === 'Cash sale')
      .reduce((sum, movement) => sum + movement.amount, 0),
    cashRefunds: cashMovements
      .filter((movement) => movement.source === 'Cash refund')
      .reduce((sum, movement) => sum + movement.amount, 0),
    manualIn: cashMovements
      .filter((movement) => movement.source === 'Manual' && movement.direction === 'IN')
      .reduce((sum, movement) => sum + movement.amount, 0),
    manualOut: cashMovements
      .filter((movement) => movement.source === 'Manual' && movement.direction === 'OUT')
      .reduce((sum, movement) => sum + movement.amount, 0),
  }), [cashMovements]);
  const datewiseRows = useMemo(() => {
    const days = new Map<string, {
      sales: number;
      transactions: number;
      returns: number;
      returnVouchers: number;
      purchases: number;
      purchaseInvoices: number;
      cashIn: number;
      cashOut: number;
      taxCollected: number;
      taxRefunded: number;
    }>();
    const getDay = (date: string) => {
      const current = days.get(date) || {
        sales: 0,
        transactions: 0,
        returns: 0,
        returnVouchers: 0,
        purchases: 0,
        purchaseInvoices: 0,
        cashIn: 0,
        cashOut: 0,
        taxCollected: 0,
        taxRefunded: 0,
      };
      days.set(date, current);
      return current;
    };

    for (const sale of completedSales) {
      const day = getDay(dateKeyFor(sale.invoiceDate || sale.createdAt));
      day.sales += sale.total;
      day.transactions += 1;
      day.taxCollected += sale.taxAmount;
    }
    for (const voucher of filteredReturns) {
      const day = getDay(dateKeyFor(voucher.createdAt));
      day.returns += voucher.refundAmount;
      day.returnVouchers += 1;
      day.taxRefunded += voucher.taxRefundAmount;
    }
    for (const purchase of filteredPurchases) {
      const day = getDay(dateKeyFor(purchase.receivedDate || purchase.createdAt));
      day.purchases += purchase.total;
      day.purchaseInvoices += 1;
    }
    for (const movement of cashMovements) {
      const day = getDay(movement.date);
      if (movement.direction === 'IN') day.cashIn += movement.amount;
      else day.cashOut += movement.amount;
    }
    return Array.from(days, ([date, totals]) => ({
      date,
      ...totals,
      netSales: totals.sales - totals.returns,
    })).sort((a, b) => b.date.localeCompare(a.date));
  }, [completedSales, filteredReturns, filteredPurchases, cashMovements]);
  const ledgerStart =
    dailyCashRows.find((row) => row.date === cashbookOpeningBalance?.entryDate) ||
    dailyCashRows.find((row) => row.openingBalance !== null);
  const ledgerMovements = ledgerStart
    ? cashMovements.filter((movement) => movement.date >= ledgerStart.date)
    : cashMovements;
  const groupedCashMovements = (source: 'Cash sale' | 'Cash refund', particulars: string) => {
    const totals = new Map<string, number>();
    for (const movement of ledgerMovements) {
      if (movement.source === source) {
        totals.set(movement.date, (totals.get(movement.date) || 0) + movement.amount);
      }
    }
    return Array.from(totals, ([date, amount]) => ({ date, particulars, amount }));
  };
  const debitRows: LedgerLine[] = [
    ...groupedCashMovements('Cash sale', 'Sales'),
    ...ledgerMovements
      .filter((movement) => movement.source === 'Manual' && movement.direction === 'IN')
      .map((movement) => ({
        date: movement.date,
        particulars: movement.description,
        amount: movement.amount,
      })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const creditRows: LedgerLine[] = ledgerMovements
    .filter((movement) => movement.source === 'Manual' && movement.direction === 'OUT')
    .map((movement) => ({ date: movement.date, particulars: movement.description, amount: movement.amount }))
    .concat(groupedCashMovements('Cash refund', 'Sales Returns'))
    .sort((a, b) => a.date.localeCompare(b.date));
  const totalDebit = debitRows.reduce((sum, row) => sum + row.amount, 0);
  const totalCredit = creditRows.reduce((sum, row) => sum + row.amount, 0);
  const ledgerOpeningBalance = ledgerStart?.openingBalance ?? 0;
  const ledgerNetBalance = totalDebit - totalCredit;
  const ledgerClosingBalance = ledgerOpeningBalance + ledgerNetBalance;
  const ledgerNetBalanceLabel = selectedDay === toLocalDateKey(new Date())
    ? "Today's Net Balance (+/-)"
    : `${selectedDay} Net Balance (+/-)`;
  const closingCashBalance = dailyCashRows.length
    ? dailyCashRows[dailyCashRows.length - 1].closingBalance ?? ledgerClosingBalance
    : ledgerClosingBalance;
  const openingBalanceAppliesToPeriod = Boolean(
    openingBalanceIsInitial &&
      cashbookOpeningBalance &&
      cashbookOpeningBalance.entryDate <= (dateBounds.end || toLocalDateKey(new Date()))
  );

  const visibleTaxRows = taxRows.filter((row) => !query || row.date.includes(query.trim()));
  const visibleCashbookTransactions = useMemo(() => {
    const search = query.trim().toLowerCase();
    return cashbookTransactions.filter((transaction) => !search || [
      transaction.date,
      transaction.direction,
      transaction.category === 'CASH'
        ? 'Cash'
        : transaction.category === 'BANK'
          ? 'Bank'
          : transaction.category,
      transaction.description,
      transaction.reference,
      transaction.createdBy,
    ].some((value) => value.toLowerCase().includes(search)));
  }, [cashbookTransactions, query]);

  const tabs: Array<{ value: ReportTab; label: string; icon: typeof BarChart3 }> =
    mode === 'cashbook'
      ? [{ value: 'CASHBOOK', label: isRtl ? 'المدفوعات والمقبوضات' : 'Payments & Receipts', icon: Wallet }]
      : [
          { value: 'DAILY_SUMMARY', label: isRtl ? 'الملخص اليومي' : 'Daily Summary', icon: CalendarDays },
          { value: 'DETAILED_SALES', label: isRtl ? 'تفاصيل المبيعات' : 'Detailed Sales', icon: FileText },
          { value: 'DATEWISE_SUMMARY', label: isRtl ? 'الملخص حسب التاريخ' : 'Datewise Summary', icon: BarChart3 },
          { value: 'TAX', label: isRtl ? 'تقارير الضرائب' : 'Tax Reports', icon: Receipt },
          { value: 'SALES_TAX', label: isRtl ? 'تقارير المبيعات والضريبة' : 'Sales Tax Reports', icon: FileText },
        ];
  const activeReportLabel = tabs.find((tab) => tab.value === activeReport)?.label || 'Report';
  const formatPeriodDate = (dateKey: string) =>
    new Date(`${dateKey}T12:00:00`).toLocaleDateString(isRtl ? 'ar-SA' : 'en-GB', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  const reportPeriodLabel = dateBounds.start && dateBounds.end
    ? dateBounds.start === dateBounds.end
      ? formatPeriodDate(dateBounds.start)
      : `${formatPeriodDate(dateBounds.start)} – ${formatPeriodDate(dateBounds.end)}`
    : dateBounds.start
      ? `${isRtl ? 'من' : 'From'} ${formatPeriodDate(dateBounds.start)}`
      : dateBounds.end
        ? `${isRtl ? 'حتى' : 'Through'} ${formatPeriodDate(dateBounds.end)}`
        : (isRtl ? 'كل التواريخ' : 'All dates');

  const createWorkbook = () => {
    const workbook = XLSX.utils.book_new();
    if (activeReport === 'DETAILED_SALES') {
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          filteredDetailedSales.map((sale) => ({
            Invoice: sale.receiptNumber,
            Date: sale.invoiceDate || sale.createdAt,
            Customer: sale.customerName,
            'Payment method': sale.paymentMethod,
            Cashier: sale.cashierName,
            Subtotal: Number(sale.subtotal.toFixed(2)),
            Discount: Number(sale.discountAmount.toFixed(2)),
            VAT: Number(sale.taxAmount.toFixed(2)),
            Total: Number(sale.total.toFixed(2)),
            'Amount tendered': Number(sale.amountTendered.toFixed(2)),
            'Change due': Number(sale.changeDue.toFixed(2)),
            'Return status': sale.returnStatus || 'None',
          }))
        ),
        'Detailed sales'
      );
    } else if (activeReport === 'SALES_TAX') {
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['Metric', 'Value'],
          ['Completed sales', completedSales.length],
          ['Gross sales', Number(salesTotal.toFixed(2))],
          ['Discounts', Number(discountsTotal.toFixed(2))],
          ['Tax collected', Number(salesTaxTotal.toFixed(2))],
          ['Returns', Number(returnsTotal.toFixed(2))],
          ['Net sales', Number(netSalesTotal.toFixed(2))],
        ]),
        'Sales summary'
      );
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          paymentRows.map((row) => ({
            Payment: row.method,
            Transactions: row.transactions,
            Sales: Number(row.total.toFixed(2)),
            Tax: Number(row.tax.toFixed(2)),
          }))
        ),
        'By payment'
      );
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          cashierRows.map((row) => ({
            Cashier: row.cashier,
            Transactions: row.transactions,
            Sales: Number(row.total.toFixed(2)),
            Tax: Number(row.tax.toFixed(2)),
          }))
        ),
        'By cashier'
      );
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          productRows.map((row) => ({
            SKU: row.sku,
            Product: row.product,
            'Quantity sold': row.sold,
            'Quantity returned': row.returned,
            'Gross sales': Number(row.gross.toFixed(2)),
            Refunds: Number(row.refund.toFixed(2)),
          }))
        ),
        'By product'
      );
    } else if (activeReport === 'TAX') {
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          visibleTaxRows.map((row) => ({
            Date: row.date,
            'Tax collected': Number(row.collected.toFixed(2)),
            'Tax refunded': Number(row.refunded.toFixed(2)),
            'Net tax': Number(row.net.toFixed(2)),
          }))
        ),
        'Daily tax'
      );
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['Metric', 'Value'],
          ['Tax collected', Number(salesTaxTotal.toFixed(2))],
          ['Tax refunded', Number(returnedTaxTotal.toFixed(2))],
          ['Net tax', Number((salesTaxTotal - returnedTaxTotal).toFixed(2))],
        ]),
        'Tax summary'
      );
    } else if (activeReport === 'CASHBOOK') {
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['Metric', 'Value'],
          ['Cash In', Number(cashbookEntryTotals.cashIn.toFixed(2))],
          ['Cash Out', Number(cashbookEntryTotals.cashOut.toFixed(2))],
          ['Transactions', cashbookTransactions.length],
        ]),
        'Cashbook summary'
      );
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['Date', 'Direction', 'Payment Type', 'Account', 'Remarks', 'Reference', 'Amount', 'Entered by'],
          ...cashbookTransactions.map((transaction) => [
            transaction.date,
            transaction.direction === 'IN' ? 'Cash In' : 'Cash Out',
            transaction.paymentType || '',
            transaction.accountName || transaction.category,
            transaction.description,
            transaction.reference,
            Number(transaction.amount.toFixed(2)),
            transaction.createdBy,
          ]),
        ]),
        'Transactions'
      );
    } else if (activeReport === 'DATEWISE_SUMMARY') {
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          datewiseRows.map((row) => ({
            Date: row.date,
            Transactions: row.transactions,
            Sales: Number(row.sales.toFixed(2)),
            Returns: Number(row.returns.toFixed(2)),
            'Net sales': Number(row.netSales.toFixed(2)),
            'Purchase invoices': row.purchaseInvoices,
            'Purchase value (not cash paid)': Number(row.purchases.toFixed(2)),
            'Cash in': Number(row.cashIn.toFixed(2)),
            'Cash out': Number(row.cashOut.toFixed(2)),
            'Tax collected': Number(row.taxCollected.toFixed(2)),
            'Tax refunded': Number(row.taxRefunded.toFixed(2)),
          }))
        ),
        'Datewise activity'
      );
    } else {
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['Business activity', 'Value'],
          ['Completed sales', completedSales.length],
          ['Gross sales', Number(salesTotal.toFixed(2))],
          ['Returns', Number(returnsTotal.toFixed(2))],
          ['Net sales', Number(netSalesTotal.toFixed(2))],
          ['Tax collected', Number(salesTaxTotal.toFixed(2))],
          ['Tax refunded', Number(returnedTaxTotal.toFixed(2))],
          ['Purchase invoices', filteredPurchases.length],
          ['Purchase value (not cash paid)', Number(filteredPurchases.reduce((sum, purchase) => sum + purchase.total, 0).toFixed(2))],
          ['Cash sales', Number(cashbookTotals.cashSales.toFixed(2))],
          ['Cash refunds', Number(cashbookTotals.cashRefunds.toFixed(2))],
          ['Manual cash in', Number(cashbookTotals.manualIn.toFixed(2))],
          ['Manual cash out', Number(cashbookTotals.manualOut.toFixed(2))],
          ['Closing cash balance', closingCashBalance === null ? '' : Number(closingCashBalance.toFixed(2))],
        ]),
        'Daily summary'
      );
      const ledgerRowCount = Math.max(debitRows.length, creditRows.length);
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['DEBIT — CASH IN', '', '', 'CREDIT — CASH OUT', '', ''],
          ['Date', 'Particulars', 'Amount', 'Date', 'Particulars', 'Amount'],
          ...Array.from({ length: ledgerRowCount }, (_, index) => {
            const debit = debitRows[index];
            const credit = creditRows[index];
            return [
              debit?.date || '',
              debit?.particulars || '',
              debit ? Number(debit.amount.toFixed(2)) : '',
              credit?.date || '',
              credit?.particulars || '',
              credit ? Number(credit.amount.toFixed(2)) : '',
            ];
          }),
          ['', 'Total Debit', Number(totalDebit.toFixed(2)), '', 'Total Credit', Number(totalCredit.toFixed(2))],
          ['', 'Closing cash balance', ledgerClosingBalance === null ? '' : Number(ledgerClosingBalance.toFixed(2)), '', '', ''],
        ]),
        'Debit-credit ledger'
      );
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          paymentRows.map((row) => ({
            Payment: row.method,
            Transactions: row.transactions,
            Sales: Number(row.total.toFixed(2)),
            Tax: Number(row.tax.toFixed(2)),
          }))
        ),
        'Sales by payment'
      );
    }
    return workbook;
  };

  const handleExportExcel = () => {
    setExportError(null);
    try {
      const workbook = createWorkbook();
      XLSX.writeFile(
        workbook,
        `${activeReport.toLowerCase()}-report-${new Date().toISOString().slice(0, 10)}.xlsx`
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Failed to export report to Excel.');
    }
  };

  const handleExportPdf = async () => {
    setExportError(null);
    if (activeReport === 'TAX') {
      setExportingPdf(true);
      try {
        const format: PaperWidth = 'A4';
        const profile = settings.printDocumentProfiles?.['saudi-vat-report']?.[format];
        const template = resolvePrintTemplate('saudi-vat-report', format, profile?.templateId);
        const data: PrintDocumentData = {
          documentType: 'saudi-vat-report',
          title: isRtl ? 'ملخص ضريبة القيمة المضافة' : 'Saudi VAT Summary',
          date: reportPeriodLabel,
          companyName: settings.storeName,
          companyNameAr: settings.storeNameAr,
          companyAddress: settings.address,
          companyPhone: settings.phone,
          companyTaxId: settings.taxId,
          companyLogo: settings.storeLogoDataUrl,
          fields: [
            { label: isRtl ? 'الفترة' : 'Reporting period', value: reportPeriodLabel },
            { label: isRtl ? 'العملة' : 'Currency', value: settings.currencySymbol },
          ],
          columns: [
            isRtl ? 'التاريخ' : 'Date',
            isRtl ? 'ضريبة محصلة' : 'Tax collected',
            isRtl ? 'ضريبة مستردة' : 'Tax refunded',
            isRtl ? 'صافي الضريبة' : 'Net tax',
          ],
          rows: visibleTaxRows.map((row) => ({
            values: [
              row.date,
              `${currency}${row.collected.toFixed(2)}`,
              `${currency}${row.refunded.toFixed(2)}`,
              `${currency}${row.net.toFixed(2)}`,
            ],
          })),
          totals: [
            { label: isRtl ? 'ضريبة المبيعات المحصلة' : 'Tax collected', value: `${currency}${salesTaxTotal.toFixed(2)}` },
            { label: isRtl ? 'ضريبة المرتجعات' : 'Tax refunded', value: `${currency}${returnedTaxTotal.toFixed(2)}` },
            { label: isRtl ? 'صافي الضريبة' : 'Net tax', value: `${currency}${(salesTaxTotal - returnedTaxTotal).toFixed(2)}` },
          ],
          footer: isRtl
            ? 'تقرير إداري من بيانات النظام، وليس نموذج إقرار ضريبي رسمي.'
            : 'Management report from recorded POS data; not an official VAT return filing.',
          direction: isRtl ? 'rtl' : 'ltr',
        };
        const job = await createPrintTemplateJob(data, settings, format, template.id);
        await printTemplateJob(job);
      } catch (error) {
        setExportError(error instanceof Error ? error.message : 'Failed to print the Saudi VAT report.');
      } finally {
        setExportingPdf(false);
      }
      return;
    }

    const reportFilePeriod = dateBounds.start && dateBounds.end
      ? dateBounds.start === dateBounds.end
        ? dateBounds.start
        : `${dateBounds.start}-to-${dateBounds.end}`
      : new Date().toISOString().slice(0, 10);
    const fileName = `${activeReport.toLowerCase()}-report-${reportFilePeriod}.pdf`;
    if (window.electronAPI?.exportPdf) {
      setExportingPdf(true);
      try {
        await window.electronAPI.exportPdf({
          fileName,
        });
      } catch (error) {
        setExportError(error instanceof Error ? error.message : 'Failed to export report PDF.');
      } finally {
        setExportingPdf(false);
      }
      return;
    }
    window.print();
  };

  const handleCreateEntry = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCashbookError(null);
    setSavingCashbook(true);
    try {
      await onCreateCashbookEntry({
        entryDate,
        direction: entryDirection,
        category: entryAccount,
        paymentType: entryPaymentType,
        accountName: entryAccount,
        description: entryDescription.trim(),
        amount: Number(entryAmount),
        reference: entryReference.trim(),
      });
      setEntryPaymentType('CASH');
      setEntryAccount('Cash');
      setEntryDescription('');
      setEntryAmount('');
      setEntryReference('');
    } catch (error) {
      setCashbookError(error instanceof Error ? error.message : 'Failed to save cashbook entry.');
    } finally {
      setSavingCashbook(false);
    }
  };

  const dateFilterLabel = (filter: DateFilter) => {
    const labels: Record<DateFilter, string> = isRtl
      ? {
          ALL: 'كل التواريخ',
          RANGE: 'نطاق تاريخ',
          TODAY: 'اليوم',
          YESTERDAY: 'أمس',
          THIS_WEEK: 'هذا الأسبوع',
          THIS_MONTH: 'هذا الشهر',
        }
      : {
          ALL: 'Any date',
          RANGE: 'Date Range',
          TODAY: 'Today',
          YESTERDAY: 'Yesterday',
          THIS_WEEK: 'This Week',
          THIS_MONTH: 'This Month',
        };
    return labels[filter];
  };

  const summaryMetrics = activeReport === 'CASHBOOK'
    ? [
        {
          label: 'Cash In',
          value: `${currency}${cashbookEntryTotals.cashIn.toFixed(2)}`,
          valueClassName: 'text-emerald-700',
        },
        {
          label: 'Cash Out',
          value: `${currency}${cashbookEntryTotals.cashOut.toFixed(2)}`,
          valueClassName: 'text-rose-700',
        },
        {
          label: 'Transactions',
          value: String(cashbookTransactions.length),
          valueClassName: 'text-slate-900',
        },
      ]
    : activeReport === 'DETAILED_SALES'
      ? [
          {
            label: isRtl ? 'عدد الفواتير' : 'Invoices',
            value: String(filteredDetailedSales.length),
          },
          {
            label: isRtl ? 'إجمالي المبيعات' : 'Sales total',
            value: `${currency}${detailedSalesTotals.total.toFixed(2)}`,
          },
          {
            label: isRtl ? 'الخصومات' : 'Discounts',
            value: `${currency}${detailedSalesTotals.discount.toFixed(2)}`,
          },
          {
            label: isRtl ? 'ضريبة القيمة المضافة' : 'VAT',
            value: `${currency}${detailedSalesTotals.tax.toFixed(2)}`,
          },
        ]
      : [
          {
            label: isRtl ? 'إجمالي المبيعات' : 'Gross sales',
            value: `${currency}${salesTotal.toFixed(2)}`,
          },
          {
            label: isRtl ? 'عدد الفواتير' : 'Sales invoices',
            value: String(completedSales.length),
          },
          {
            label: isRtl ? 'المبالغ المستردة' : 'Refunds',
            value: `${currency}${returnsTotal.toFixed(2)}`,
          },
          {
            label: isRtl ? 'صافي المبيعات' : 'Net sales',
            value: `${currency}${netSalesTotal.toFixed(2)}`,
          },
        ];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50 p-3 lg:p-6">
      <div className="mx-auto max-w-[1440px] space-y-3 lg:space-y-5">
        {mode !== 'cashbook' && (
        <header className="no-print flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-700 text-white shadow-sm">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 lg:text-xl">
                {isRtl ? 'التقارير' : 'Reports'}
              </h1>
              <p className="mt-0.5 text-xs text-slate-500">
                {isRtl
                  ? 'الملخص اليومي والتاريخي وتقارير الضرائب والمبيعات.'
                  : 'Daily and datewise summaries, tax reports, and sales tax reports.'}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {isSingleDaySummary ? (
              <>
                <label className="self-center text-sm text-slate-600" htmlFor="reports-summary-day">
                  {isRtl ? 'اختر اليوم' : 'Choose a day'}
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={isRtl ? 'اليوم السابق' : 'Previous day'}
                    title={isRtl ? 'اليوم السابق' : 'Previous day'}
                    onClick={() => setSelectedDay(shiftDateKey(selectedDay, -1))}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                  >
                    {isRtl ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                  </button>
                  <input
                    id="reports-summary-day"
                    type="date"
                    value={selectedDay}
                    onChange={(event) => {
                      if (event.target.value) setSelectedDay(event.target.value);
                    }}
                    className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    aria-label={isRtl ? 'اليوم التالي' : 'Next day'}
                    title={isRtl ? 'اليوم التالي' : 'Next day'}
                    onClick={() => setSelectedDay(shiftDateKey(selectedDay, 1))}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                  >
                    {isRtl ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                </div>
              </>
            ) : (
              <>
                <label className="sr-only" htmlFor="reports-date-filter">
                  {isRtl ? 'تصفية حسب التاريخ' : 'Filter by date'}
                </label>
                <select
                  id="reports-date-filter"
                  value={dateFilter}
                  onChange={(event) => setDateFilter(event.target.value as DateFilter)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100"
                >
                  {(['ALL', 'RANGE', 'TODAY', 'YESTERDAY', 'THIS_WEEK', 'THIS_MONTH'] as const).map(
                    (filter) => (
                      <option key={filter} value={filter}>{dateFilterLabel(filter)}</option>
                    )
                  )}
                </select>
                {dateFilter === 'RANGE' && (
                  <>
                    <label className="sr-only" htmlFor="reports-date-from">From date</label>
                    <input
                      id="reports-date-from"
                      type="date"
                      value={dateFrom}
                      onChange={(event) => {
                        setDateFrom(event.target.value);
                        if (dateTo && event.target.value && dateTo < event.target.value) setDateTo('');
                      }}
                      className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                    />
                    <label className="sr-only" htmlFor="reports-date-to">To date</label>
                    <input
                      id="reports-date-to"
                      type="date"
                      min={dateFrom || undefined}
                      value={dateTo}
                      onChange={(event) => setDateTo(event.target.value)}
                      className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                    />
                  </>
                )}
              </>
            )}
          </div>
        </header>
        )}

        <div className="no-print flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          {mode !== 'cashbook' && (
            <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    aria-pressed={activeReport === tab.value}
                    onClick={() => {
                      setActiveReport(tab.value);
                      setQuery('');
                    }}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                      activeReport === tab.value
                        ? 'bg-blue-700 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex gap-2">
            {mode === 'cashbook' && (
              <select
                value={dateFilter}
                onChange={(event) => setDateFilter(event.target.value as DateFilter)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                aria-label={isRtl ? 'تصفية حسب التاريخ' : 'Filter by date'}
              >
                {(['ALL', 'RANGE', 'TODAY', 'YESTERDAY', 'THIS_WEEK', 'THIS_MONTH'] as const).map(
                  (filter) => (
                    <option key={filter} value={filter}>{dateFilterLabel(filter)}</option>
                  )
                )}
              </select>
            )}
            {(activeReport === 'TAX' || activeReport === 'DATEWISE_SUMMARY' || activeReport === 'CASHBOOK') && (
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={
                  activeReport === 'CASHBOOK'
                      ? 'Search cash movement'
                      : 'Search date'
                }
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs sm:w-56 sm:flex-none"
              />
            )}
            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
            >
              <FileSpreadsheet className="h-4 w-4" />
              {isRtl ? 'تصدير Excel' : 'Export Excel'}
            </button>
            <button
              type="button"
              disabled={exportingPdf}
              onClick={handleExportPdf}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
            >
              <FileText className="h-4 w-4" />
              {exportingPdf
                ? (isRtl ? 'جارٍ التصدير...' : 'Exporting...')
                : (isRtl ? 'تصدير PDF' : 'Export PDF')}
            </button>
          </div>
        </div>

        {exportError && (
          <p role="alert" className="no-print rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {exportError}
          </p>
        )}

        <main className="report-print-area space-y-4 rounded-2xl bg-slate-50 print:bg-white">
          <div className="report-print-heading hidden print:block border-b-2 border-slate-800 pb-4">
            <div className="flex items-start justify-between gap-8">
              <div className="space-y-1">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                  {settings.storeName || 'aptPOS'}
                </p>
                <h1 className="text-2xl font-extrabold text-slate-950">
                  {mode === 'cashbook'
                    ? (isRtl ? 'المدفوعات والمقبوضات' : 'Payments & Receipts')
                    : activeReportLabel}
                </h1>
                <p className="text-sm font-semibold text-slate-700">
                  {isRtl ? 'الفترة' : 'Report period'}: {reportPeriodLabel}
                </p>
                {activeReport === 'DETAILED_SALES' && (
                  <p className="text-xs text-slate-600">
                    {isRtl ? 'طريقة الدفع' : 'Payment type'}: {salesPaymentFilter === 'ALL' ? (isRtl ? 'الكل' : 'All') : salesPaymentFilter}
                    {' · '}
                    {isRtl ? 'العميل' : 'Customer'}: {salesCustomerFilter === 'ALL' ? (isRtl ? 'الكل' : 'All') : salesCustomerFilter}
                  </p>
                )}
                {settings.address && (
                  <p className="text-xs text-slate-500">{settings.address}</p>
                )}
              </div>
              <div className="space-y-1 text-right text-xs text-slate-600">
                <p>
                  {isRtl ? 'تم الإنشاء' : 'Generated'}: {new Date().toLocaleString()}
                </p>
                {settings.phone && <p>{settings.phone}</p>}
                {settings.taxId && <p>{isRtl ? 'الرقم الضريبي' : 'Tax ID'}: {settings.taxId}</p>}
                <p>{isRtl ? 'العملة' : 'Currency'}: {settings.currencySymbol}</p>
              </div>
            </div>
          </div>

          <section
            aria-label={isRtl ? 'ملخص التقرير' : 'Report summary'}
            className={activeReport === 'CASHBOOK' ? 'grid grid-cols-1 gap-2 sm:grid-cols-3' : 'grid grid-cols-2 gap-2 xl:grid-cols-4'}
          >
            {summaryMetrics.map((metric) => (
              <article key={metric.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm lg:p-4">
                <p className="text-[10px] font-medium text-slate-500 lg:text-xs">{metric.label}</p>
                <p className={`mt-1 font-mono text-base font-bold tabular-nums lg:text-xl ${'valueClassName' in metric ? metric.valueClassName : 'text-slate-900'}`}>
                  {metric.value}
                </p>
              </article>
            ))}
          </section>

          {activeReport === 'DAILY_SUMMARY' && (
            <div className="space-y-4">
              <DebitCreditLedger
                currency={currency}
                debitRows={debitRows}
                creditRows={creditRows}
                openingBalance={ledgerOpeningBalance}
                netBalanceLabel={ledgerNetBalanceLabel}
                netBalance={ledgerNetBalance}
                closingBalance={ledgerClosingBalance}
              />
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {!openingBalanceAppliesToPeriod && 'No opening balance applies to this period; opening and closing balances are calculated cumulatively from the first transaction date. '}
                Purchases are excluded from cash totals because payment allocations are not recorded. Split-tender sales are also excluded until tender amounts are tracked.
              </p>
            </div>
          )}

          {activeReport === 'DETAILED_SALES' && (
            <div className="space-y-3">
              <section
                aria-label={isRtl ? 'تصفية تفاصيل المبيعات' : 'Detailed sales filters'}
                className="no-print grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2"
              >
                <label className="space-y-1 text-xs font-semibold text-slate-700">
                  {isRtl ? 'طريقة الدفع' : 'Payment type'}
                  <select
                    value={salesPaymentFilter}
                    onChange={(event) => setSalesPaymentFilter(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal"
                  >
                    <option value="ALL">{isRtl ? 'كل طرق الدفع' : 'All payment types'}</option>
                    {detailedSalesPaymentOptions.map((method) => (
                      <option key={method} value={method}>{method}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs font-semibold text-slate-700">
                  {isRtl ? 'العميل' : 'Customer'}
                  <select
                    value={salesCustomerFilter}
                    onChange={(event) => setSalesCustomerFilter(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal"
                  >
                    <option value="ALL">{isRtl ? 'كل العملاء' : 'All customers'}</option>
                    {detailedSalesCustomerOptions.map((customer) => (
                      <option key={customer} value={customer}>{customer}</option>
                    ))}
                  </select>
                </label>
              </section>
              <ReportTable
                title={isRtl ? 'تفاصيل المبيعات' : 'Sales transactions'}
                headers={isRtl
                  ? ['الفاتورة', 'التاريخ والوقت', 'العميل', 'طريقة الدفع', 'الكاشير', 'المجموع الفرعي', 'الخصم', 'الضريبة', 'الإجمالي', 'المبلغ المدفوع', 'الباقي', 'المرتجعات']
                  : ['Invoice', 'Date / time', 'Customer', 'Payment type', 'Cashier', 'Subtotal', 'Discount', 'VAT', 'Total', 'Amount tendered', 'Change due', 'Returns']}
                rows={filteredDetailedSales.map((sale) => [
                  sale.receiptNumber,
                  getInvoiceDateTime(sale.invoiceDate, sale.createdAt).toLocaleString(isRtl ? 'ar-SA' : 'en-GB'),
                  sale.customerName,
                  sale.paymentMethod,
                  sale.cashierName,
                  `${currency}${sale.subtotal.toFixed(2)}`,
                  `${currency}${sale.discountAmount.toFixed(2)}`,
                  `${currency}${sale.taxAmount.toFixed(2)}`,
                  `${currency}${sale.total.toFixed(2)}`,
                  `${currency}${sale.amountTendered.toFixed(2)}`,
                  `${currency}${sale.changeDue.toFixed(2)}`,
                  sale.returnStatus === 'FULL'
                    ? (isRtl ? 'كامل' : 'Full')
                    : sale.returnStatus === 'PARTIAL'
                      ? (isRtl ? 'جزئي' : 'Partial')
                      : (isRtl ? 'لا يوجد' : 'None'),
                ])}
                minWidth="1380px"
              />
            </div>
          )}

          {activeReport === 'DATEWISE_SUMMARY' && (
            <div className="space-y-3">
              <ReportTable
                title="Business activity by date"
                headers={['Date', 'Sales', 'Transactions', 'Returns', 'Net sales', 'Purchase invoices', 'Purchase value', 'Cash in', 'Cash out', 'Tax collected', 'Tax refunded']}
                rows={datewiseRows
                  .filter((row) => !query.trim() || row.date.includes(query.trim()))
                  .map((row) => [
                    row.date,
                    `${currency}${row.sales.toFixed(2)}`,
                    row.transactions,
                    `${currency}${row.returns.toFixed(2)}`,
                    `${currency}${row.netSales.toFixed(2)}`,
                    row.purchaseInvoices,
                    `${currency}${row.purchases.toFixed(2)}`,
                    `${currency}${row.cashIn.toFixed(2)}`,
                    `${currency}${row.cashOut.toFixed(2)}`,
                    `${currency}${row.taxCollected.toFixed(2)}`,
                    `${currency}${row.taxRefunded.toFixed(2)}`,
                  ])}
                minWidth="1120px"
              />
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Purchase values are invoice activity, not cash paid. Split-tender sales are excluded from cash movement totals until tender allocations are recorded.
              </p>
            </div>
          )}

          {activeReport === 'SALES_TAX' && (
            <div className="space-y-4">
              <section className="grid gap-4 xl:grid-cols-2">
                <ReportTable
                  title={isRtl ? 'المبيعات حسب طريقة الدفع' : 'Sales by payment method'}
                  headers={['Payment', 'Transactions', 'Sales', 'Tax']}
                  rows={paymentRows.map((row) => [
                    row.method,
                    row.transactions,
                    `${currency}${row.total.toFixed(2)}`,
                    `${currency}${row.tax.toFixed(2)}`,
                  ])}
                />
                <ReportTable
                  title={isRtl ? 'المبيعات حسب الكاشير' : 'Sales by cashier'}
                  headers={['Cashier', 'Transactions', 'Sales', 'Tax']}
                  rows={cashierRows.map((row) => [
                    row.cashier,
                    row.transactions,
                    `${currency}${row.total.toFixed(2)}`,
                    `${currency}${row.tax.toFixed(2)}`,
                  ])}
                />
              </section>
              <ReportTable
                title={isRtl ? 'المبيعات حسب الصنف' : 'Sales by product'}
                headers={['SKU', 'Product', 'Qty sold', 'Qty returned', 'Gross sales', 'Refunds']}
                rows={productRows.map((row) => [
                  row.sku,
                  row.product,
                  row.sold,
                  row.returned,
                  `${currency}${row.gross.toFixed(2)}`,
                  `${currency}${row.refund.toFixed(2)}`,
                ])}
                minWidth="760px"
              />
            </div>
          )}

          {activeReport === 'TAX' && (
            <div className="space-y-4">
              <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  {
                    label: isRtl ? 'ضريبة المبيعات المحصلة' : 'Sales tax collected',
                    value: salesTaxTotal,
                  },
                  {
                    label: isRtl ? 'ضريبة المرتجعات' : 'Tax refunded',
                    value: returnedTaxTotal,
                  },
                  {
                    label: isRtl ? 'صافي الضريبة' : 'Net tax',
                    value: salesTaxTotal - returnedTaxTotal,
                  },
                ].map((metric) => (
                  <article key={metric.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-xs font-medium text-slate-500">{metric.label}</p>
                    <p className="mt-1 font-mono text-xl font-bold tabular-nums text-slate-900">
                      {currency}{metric.value.toFixed(2)}
                    </p>
                  </article>
                ))}
              </section>
              <ReportTable
                title={isRtl ? 'ملخص الضريبة اليومي' : 'Daily tax summary'}
                headers={['Date', 'Tax collected', 'Tax refunded', 'Net tax']}
                rows={visibleTaxRows.map((row) => [
                  row.date,
                  `${currency}${row.collected.toFixed(2)}`,
                  `${currency}${row.refunded.toFixed(2)}`,
                  `${currency}${row.net.toFixed(2)}`,
                ])}
              />
            </div>
          )}

          {activeReport === 'CASHBOOK' && (
            <div className="space-y-4">
              {canManageCashbook && (
                <section className="no-print">
                  <form
                    onSubmit={handleCreateEntry}
                    className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <h2 className="text-sm font-bold text-slate-900">New Payment / Receipt</h2>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-xs font-medium text-slate-600">
                        Date
                        <input
                          required
                          type="date"
                          value={entryDate}
                          onChange={(event) => setEntryDate(event.target.value)}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="space-y-1 text-xs font-medium text-slate-600">
                        Direction
                        <select
                          value={entryDirection}
                          onChange={(event) => setEntryDirection(event.target.value as 'IN' | 'OUT')}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        >
                          <option value="IN">Cash in</option>
                          <option value="OUT">Cash out</option>
                        </select>
                      </label>
                      <label className="space-y-1 text-xs font-medium text-slate-600">
                        Payment Type
                        <select
                          required
                          value={entryPaymentType}
                          onChange={(event) => setEntryPaymentType(event.target.value as 'CASH' | 'BANK')}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        >
                          <option value="CASH">Cash</option>
                          <option value="BANK">Bank</option>
                        </select>
                      </label>
                      <label className="space-y-1 text-xs font-medium text-slate-600">
                        Account
                        <select
                          required
                          value={entryAccount}
                          onChange={(event) => setEntryAccount(event.target.value)}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        >
                          {Array.from(new Set(['Cash', 'Bank', ...accountOptions])).map((account) => (
                            <option key={account} value={account}>{account}</option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1 text-xs font-medium text-slate-600">
                        Amount
                        <input
                          required
                          min="0.01"
                          step="0.01"
                          type="number"
                          value={entryAmount}
                          onChange={(event) => setEntryAmount(event.target.value)}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="space-y-1 text-xs font-medium text-slate-600 sm:col-span-2">
                        Remarks
                        <input
                          required
                          value={entryDescription}
                          onChange={(event) => setEntryDescription(event.target.value)}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="space-y-1 text-xs font-medium text-slate-600 sm:col-span-2">
                        Reference (optional)
                        <input
                          value={entryReference}
                          onChange={(event) => setEntryReference(event.target.value)}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </label>
                    </div>
                    <button
                      type="submit"
                      disabled={savingCashbook || !entryDate || !entryAccount || !entryDescription.trim() || !entryAmount}
                      className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                    >
                      Save
                    </button>
                  </form>
                </section>
              )}
              {cashbookError && (
                <p role="alert" className="no-print rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  {cashbookError}
                </p>
              )}
              <ReportTable
                title="Transactions"
                headers={['Date', 'Direction', 'Payment Type', 'Account', 'Remarks', 'Reference', 'Amount', 'Entered by']}
                rows={visibleCashbookTransactions.map((transaction) => [
                  transaction.date,
                  transaction.direction === 'IN' ? 'Cash In' : 'Cash Out',
                  transaction.paymentType || (transaction.category === 'CASH' || transaction.category === 'BANK'
                    ? transaction.category
                    : '—'),
                  transaction.accountName || transaction.category,
                  transaction.description,
                  transaction.reference || '—',
                  `${transaction.direction === 'OUT' ? '-' : '+'}${currency}${transaction.amount.toFixed(2)}`,
                  transaction.createdBy,
                ])}
                cellClassName={(rowIndex, cellIndex) => {
                  if (cellIndex !== 6) return '';
                  return visibleCashbookTransactions[rowIndex]?.direction === 'IN'
                    ? 'font-semibold text-emerald-700'
                    : 'font-semibold text-rose-700';
                }}
                minWidth="1040px"
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

interface ReportTableProps {
  title: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  cellClassName?: (rowIndex: number, cellIndex: number) => string;
  minWidth?: string;
}

const ReportTable: React.FC<ReportTableProps> = ({
  title,
  headers,
  rows,
  cellClassName,
  minWidth = '520px',
}) => (
  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-bold text-slate-900">
      {title}
    </h2>
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs" style={{ minWidth }}>
        <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          <tr className="border-b border-slate-200">
            {headers.map((header) => (
              <th key={header} className="whitespace-nowrap px-3 py-2.5">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length > 0 ? (
            rows.map((row, index) => (
              <tr key={index} className="hover:bg-slate-50">
                {row.map((value, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={`max-w-[260px] truncate whitespace-nowrap px-3 py-2.5 ${cellClassName?.(index, cellIndex) || 'text-slate-700'}`}
                  >
                    {value}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length} className="px-3 py-10 text-center text-xs text-slate-500">
                No report data for this period.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </section>
);

interface DebitCreditLedgerProps {
  currency: string;
  debitRows: LedgerLine[];
  creditRows: LedgerLine[];
  openingBalance: number;
  netBalanceLabel: string;
  netBalance: number;
  closingBalance: number;
}

function DebitCreditLedger({
  currency,
  debitRows,
  creditRows,
  openingBalance,
  netBalanceLabel,
  netBalance,
  closingBalance,
}: DebitCreditLedgerProps) {
  const sides = [
    {
      title: 'DEBIT — CASH IN',
      rows: debitRows,
      total: debitRows.reduce((sum, row) => sum + row.amount, 0),
      headerClass: 'bg-emerald-50 text-emerald-800',
      amountClass: 'text-emerald-700',
    },
    {
      title: 'CREDIT — CASH OUT',
      rows: creditRows,
      total: creditRows.reduce((sum, row) => sum + row.amount, 0),
      headerClass: 'bg-rose-50 text-rose-800',
      amountClass: 'text-rose-700',
    },
  ];

  return (
    <div className="space-y-3">
      <section className="grid gap-4 lg:grid-cols-2">
        {sides.map((side) => (
          <div
            key={side.title}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            <h2 className={`px-4 py-3 text-sm font-extrabold tracking-wide ${side.headerClass}`}>
              {side.title}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-left text-xs">
                <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5">Particulars</th>
                    <th className="px-3 py-2.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {side.rows.length > 0 ? (
                    side.rows.map((row, index) => (
                      <tr key={`${row.date}-${row.particulars}-${index}`}>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{row.date}</td>
                        <td className="px-3 py-2.5 text-slate-700">{row.particulars}</td>
                        <td className={`whitespace-nowrap px-3 py-2.5 text-right font-bold tabular-nums ${side.amountClass}`}>
                          {currency}{row.amount.toFixed(2)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="px-3 py-8 text-center text-xs text-slate-500">
                        No cash movements for this period.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className={`${side.headerClass} font-extrabold`}>
                  <tr>
                    <td colSpan={2} className="px-3 py-3">Total {side.title.split(' ')[0]}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      {currency}{side.total.toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))}
      </section>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          {
            label: 'Opening Balance',
            value: `${currency}${openingBalance.toFixed(2)}`,
            color: 'text-blue-700',
          },
          {
            label: netBalanceLabel,
            value: `${currency}${netBalance >= 0 ? '+' : '-'}${Math.abs(netBalance).toFixed(2)}`,
            color: netBalance > 0
              ? 'text-emerald-700'
              : netBalance < 0
                ? 'text-rose-700'
                : 'text-slate-700',
          },
          {
            label: 'Closing Balance',
            value: `${currency}${closingBalance.toFixed(2)}`,
            color: 'text-blue-700',
          },
        ].map((metric) => (
          <article key={metric.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm lg:p-4">
            <p className="text-xs font-semibold text-slate-500">{metric.label}</p>
            <p className={`mt-1 font-mono text-lg font-extrabold tabular-nums ${metric.color}`}>
              {metric.value}
            </p>
          </article>
        ))}
      </section>
    </div>
  );
}
