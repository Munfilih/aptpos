import React, { useMemo, useState } from 'react';
import { Download, FileText, Search } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { CashbookEntry, Customer, PurchaseEntry, Sale, SalesReturnVoucher, StoreSettings, Vendor } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';

interface LedgerViewProps {
  customers: Customer[];
  vendors: Vendor[];
  sales: Sale[];
  purchases: PurchaseEntry[];
  returnVouchers: SalesReturnVoucher[];
  cashbookEntries: CashbookEntry[];
  settings: StoreSettings;
}

interface LedgerRow {
  party: string;
  accountType: 'Customer' | 'Vendor' | 'Cash' | 'Bank';
  transactions: number;
  debit: number;
  credit: number;
  balance: number;
}

export const LedgerView: React.FC<LedgerViewProps> = ({
  customers,
  vendors,
  sales,
  purchases,
  returnVouchers,
  cashbookEntries,
  settings,
}) => {
  const { isRtl } = useLanguage();
  const [search, setSearch] = useState('');
  const [accountType, setAccountType] = useState<'ALL' | 'Customer' | 'Vendor' | 'Cash' | 'Bank'>('ALL');
  const [selectedAccount, setSelectedAccount] = useState<LedgerRow | null>(null);

  const rows = useMemo<LedgerRow[]>(() => {
    const customerRows = customers.map((customer) => {
      const customerSales = sales.filter((sale) =>
        sale.status === 'COMPLETED'
        && (sale.customerId === customer.id || sale.customerName === customer.name)
      );
      const customerRefunds = returnVouchers
        .filter((voucher) => customerSales.some((sale) => voucher.sourceInvoices.includes(sale.receiptNumber)))
        .reduce((sum, voucher) => sum + voucher.refundAmount, 0);
      const debit = customerSales.reduce((sum, sale) => {
        if (String(sale.paymentMethod).toUpperCase() !== 'CREDIT') return sum;
        return sum + Math.max(0, sale.total);
      }, 0);
      const credit = customerRefunds;

      return {
        party: isRtl ? customer.nameAr || customer.name : customer.name,
        accountType: 'Customer' as const,
        transactions: customerSales.length,
        debit,
        credit,
        balance: debit - credit,
      };
    });

    const vendorRows = vendors.map((vendor) => {
      const vendorPurchases = purchases.filter((purchase) => purchase.vendorId === vendor.id);
      const debit = vendorPurchases.reduce((sum, purchase) => sum + purchase.total, 0);
      const credit = vendorPurchases.reduce((sum, purchase) => sum + purchase.paidAmount, 0);

      return {
        party: isRtl ? vendor.nameAr || vendor.name : vendor.name,
        accountType: 'Vendor' as const,
        transactions: vendorPurchases.length,
        debit,
        credit,
        balance: debit - credit,
      };
    });

    let cashDebit = 0;
    let cashCredit = 0;
    let bankDebit = 0;
    let bankCredit = 0;

    for (const entry of cashbookEntries) {
      const accountName = (entry.accountName || entry.category || '').toUpperCase();
      const paymentType = entry.paymentType?.toUpperCase();
      const accountIsCash = accountName === 'CASH' || accountName.includes('CASH');
      const accountIsBank = accountName === 'BANK' || accountName.includes('BANK');

      if (paymentType && paymentType !== 'CASH' && paymentType !== 'BANK') continue;

      if (paymentType && accountIsCash !== accountIsBank) {
        const accountKind: 'CASH' | 'BANK' = accountIsCash ? 'CASH' : 'BANK';
        if (paymentType !== accountKind) {
          if (entry.direction === 'IN') {
            if (accountKind === 'CASH') cashDebit += entry.amount;
            else bankDebit += entry.amount;
            if (paymentType === 'CASH') cashCredit += entry.amount;
            else bankCredit += entry.amount;
          } else {
            if (accountKind === 'CASH') cashCredit += entry.amount;
            else bankCredit += entry.amount;
            if (paymentType === 'CASH') cashDebit += entry.amount;
            else bankDebit += entry.amount;
          }
          continue;
        }
      }

      if (accountIsCash) {
        if (entry.direction === 'IN') cashDebit += entry.amount;
        else cashCredit += entry.amount;
      }
      if (accountIsBank) {
        if (entry.direction === 'IN') bankDebit += entry.amount;
        else bankCredit += entry.amount;
      }
    }

    const cashEntries = cashbookEntries.filter((entry) => {
      const accountName = (entry.accountName || entry.category || '').toUpperCase();
      return accountName === 'CASH' || accountName.includes('CASH')
        || entry.paymentType === 'CASH';
    });
    const bankEntries = cashbookEntries.filter((entry) => {
      const accountName = (entry.accountName || entry.category || '').toUpperCase();
      return accountName === 'BANK' || accountName.includes('BANK')
        || entry.paymentType === 'BANK';
    });
    const cashRow: LedgerRow = {
      party: isRtl ? 'النقد' : 'Cash',
      accountType: 'Cash',
      transactions: cashEntries.length,
      debit: cashDebit,
      credit: cashCredit,
      balance: 0,
    };
    cashRow.balance = cashRow.debit - cashRow.credit;
    const bankRow: LedgerRow = {
      party: isRtl ? 'البنك' : 'Bank',
      accountType: 'Bank',
      transactions: bankEntries.length,
      debit: bankDebit,
      credit: bankCredit,
      balance: 0,
    };
    bankRow.balance = bankRow.debit - bankRow.credit;

    return [cashRow, bankRow, ...customerRows, ...vendorRows];
  }, [cashbookEntries, customers, isRtl, purchases, sales, returnVouchers, vendors]);

  const filteredRows = rows.filter((row) =>
    (accountType === 'ALL' || row.accountType === accountType)
    && (!search || row.party.toLowerCase().includes(search.toLowerCase()))
  );
  const totals = filteredRows.reduce(
    (sum, row) => ({
      debit: sum.debit + row.debit,
      credit: sum.credit + row.credit,
      balance: sum.balance + row.balance,
    }),
    { debit: 0, credit: 0, balance: 0 }
  );
  const currency = settings.currencySymbol || 'SAR';
  const balanceClass = (balance: number) =>
    balance < 0
      ? 'text-red-700'
      : balance > 0
        ? 'text-emerald-700'
        : 'text-blue-700';

  const selectedTransactions = useMemo(() => {
    if (!selectedAccount) return [];
    if (selectedAccount.accountType === 'Cash' || selectedAccount.accountType === 'Bank') {
      return cashbookEntries
        .flatMap((entry) => {
          const accountName = (entry.accountName || entry.category || '').toUpperCase();
          const paymentType = entry.paymentType?.toUpperCase();
          const selectedKind = selectedAccount.accountType.toUpperCase();
          const accountKind = accountName === 'CASH' || accountName.includes('CASH')
            ? 'CASH'
            : accountName === 'BANK' || accountName.includes('BANK')
              ? 'BANK'
              : null;
          if (!accountKind && paymentType !== selectedKind) return [];

          let debit = 0;
          let credit = 0;
          if (paymentType && accountKind && paymentType !== accountKind) {
            if (entry.direction === 'IN') {
              if (accountKind === selectedKind) debit = entry.amount;
              if (paymentType === selectedKind) credit = entry.amount;
            } else {
              if (accountKind === selectedKind) credit = entry.amount;
              if (paymentType === selectedKind) debit = entry.amount;
            }
          } else if (accountKind === selectedKind) {
            if (entry.direction === 'IN') debit = entry.amount;
            else credit = entry.amount;
          } else if (paymentType === selectedKind) {
            if (entry.direction === 'IN') credit = entry.amount;
            else debit = entry.amount;
          }

          if (debit === 0 && credit === 0) return [];
          return [{
            date: entry.entryDate,
            reference: entry.reference || '—',
            particulars: entry.description,
            debit,
            credit,
          }];
        })
        .sort((a, b) => b.date.localeCompare(a.date));
    }
    if (selectedAccount.accountType === 'Customer') {
      const customer = customers.find((item) => (isRtl ? item.nameAr || item.name : item.name) === selectedAccount.party);
      const customerSales = sales.filter((sale) =>
        sale.status === 'COMPLETED'
        && (customer ? sale.customerId === customer.id || sale.customerName === customer.name : sale.customerName === selectedAccount.party)
      );
      return [
        ...customerSales
          .filter((sale) => String(sale.paymentMethod).toUpperCase() === 'CREDIT')
          .map((sale) => ({
            date: new Date(sale.createdAt).toISOString().slice(0, 10),
            reference: sale.receiptNumber,
            particulars: 'Credit sale',
            debit: sale.total,
            credit: 0,
          })),
        ...returnVouchers
          .filter((voucher) => customerSales.some((sale) => voucher.sourceInvoices.includes(sale.receiptNumber)))
          .map((voucher) => ({
            date: new Date(voucher.createdAt).toISOString().slice(0, 10),
            reference: voucher.voucherNumber,
            particulars: 'Sales return',
            debit: 0,
            credit: voucher.refundAmount,
          })),
      ].sort((a, b) => b.date.localeCompare(a.date));
    }
    const vendor = vendors.find((item) => (isRtl ? item.nameAr || item.name : item.name) === selectedAccount.party);
    return purchases
      .filter((purchase) => vendor && purchase.vendorId === vendor.id)
      .flatMap((purchase) => [
        {
          date: purchase.receivedDate || purchase.createdAt,
          reference: purchase.invoiceNumber,
          particulars: 'Purchase invoice',
          debit: purchase.total,
          credit: 0,
        },
        ...(purchase.paidAmount > 0
          ? [{
              date: purchase.receivedDate || purchase.createdAt,
              reference: purchase.invoiceNumber,
              particulars: 'Payment',
              debit: 0,
              credit: purchase.paidAmount,
            }]
          : []),
      ])
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [cashbookEntries, customers, isRtl, purchases, sales, returnVouchers, selectedAccount, vendors]);

  const exportExcel = () => {
    const workbook = XLSX.utils.book_new();
    if (selectedAccount) {
      let running = 0;
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(selectedTransactions.map((transaction) => {
          running += transaction.debit - transaction.credit;
          return {
            Date: transaction.date,
            Reference: transaction.reference,
            Particulars: transaction.particulars,
            Debit: Number(transaction.debit.toFixed(2)),
            Credit: Number(transaction.credit.toFixed(2)),
            Balance: Number(running.toFixed(2)),
          };
        })),
        'Account Ledger'
      );
      XLSX.writeFile(workbook, `${selectedAccount.party.replace(/[^a-z0-9]+/gi, '-')}-ledger-${new Date().toISOString().slice(0, 10)}.xlsx`);
      return;
    }
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(filteredRows.map((row) => ({
        Account: row.party,
        Type: row.accountType,
        Transactions: row.transactions,
        Debit: Number(row.debit.toFixed(2)),
        Credit: Number(row.credit.toFixed(2)),
        Balance: Number(row.balance.toFixed(2)),
      }))),
      'Ledger'
    );
    XLSX.writeFile(workbook, `ledger-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportPdf = () => window.print();

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-3 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="no-print flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              {isRtl ? 'دفتر الحسابات' : 'Ledger'}
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              {isRtl ? 'أرصدة العملاء والموردين والحركات المالية' : 'Customer and vendor account balances'}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={exportExcel} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
              <Download className="h-3.5 w-3.5" />
              {isRtl ? 'تصدير Excel' : 'Export Excel'}
            </button>
            <button type="button" onClick={exportPdf} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">
              <FileText className="h-3.5 w-3.5" />
              {isRtl ? 'تصدير PDF' : 'Export PDF'}
            </button>
          </div>
        </header>

        {selectedAccount ? (
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="no-print flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">{selectedAccount.party}</h2>
                <p className="mt-0.5 text-[11px] text-slate-500">{selectedAccount.accountType} Ledger</p>
              </div>
              <button type="button" onClick={() => setSelectedAccount(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                {isRtl ? 'رجوع' : 'Back'}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">{isRtl ? 'التاريخ' : 'Date'}</th>
                    <th className="px-4 py-3 font-semibold">{isRtl ? 'المرجع' : 'Reference'}</th>
                    <th className="px-4 py-3 font-semibold">{isRtl ? 'البيان' : 'Particulars'}</th>
                    <th className="px-4 py-3 text-right font-semibold">{isRtl ? 'مدين' : 'Debit'}</th>
                    <th className="px-4 py-3 text-right font-semibold">{isRtl ? 'دائن' : 'Credit'}</th>
                    <th className="px-4 py-3 text-right font-semibold">{isRtl ? 'الرصيد' : 'Balance'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedTransactions.map((transaction, index) => {
                    const runningBalance = selectedTransactions
                      .slice(0, index + 1)
                      .reduce((sum, row) => sum + row.debit - row.credit, 0);
                    return (
                      <tr key={`${transaction.date}-${transaction.reference}-${index}`}>
                        <td className="px-4 py-3 text-slate-600">{transaction.date}</td>
                        <td className="px-4 py-3 font-mono text-slate-700">{transaction.reference}</td>
                        <td className="px-4 py-3 text-slate-700">{transaction.particulars}</td>
                        <td className="px-4 py-3 text-right font-mono">{currency}{transaction.debit.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-700">{currency}{transaction.credit.toFixed(2)}</td>
                        <td className={`px-4 py-3 text-right font-mono font-bold ${balanceClass(runningBalance)}`}>{currency}{runningBalance.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                  {selectedTransactions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                        {isRtl ? 'لا توجد حركات لهذا الحساب' : 'No transactions for this account'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <>
        <div className="no-print grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { label: isRtl ? 'إجمالي المدين' : 'Total Debit', value: totals.debit, color: 'text-slate-900' },
            { label: isRtl ? 'إجمالي الدائن' : 'Total Credit', value: totals.credit, color: 'text-emerald-700' },
            { label: isRtl ? 'الرصيد الحالي' : 'Current Balance', value: totals.balance, color: balanceClass(totals.balance) },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">{card.label}</p>
              <p className={`mt-1 font-mono text-xl font-bold ${card.color}`}>{currency}{card.value.toFixed(2)}</p>
            </div>
          ))}
        </div>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="no-print flex flex-col gap-2 border-b border-slate-200 p-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isRtl ? 'بحث بالحساب...' : 'Search account...'} className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-xs" />
            </div>
            <select value={accountType} onChange={(event) => setAccountType(event.target.value as typeof accountType)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
              <option value="ALL">{isRtl ? 'جميع الحسابات' : 'All accounts'}</option>
              <option value="Cash">{isRtl ? 'النقد' : 'Cash'}</option>
              <option value="Bank">{isRtl ? 'البنك' : 'Bank'}</option>
              <option value="Customer">{isRtl ? 'عملاء' : 'Customers'}</option>
              <option value="Vendor">{isRtl ? 'موردون' : 'Vendors'}</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">{isRtl ? 'الحساب' : 'Account'}</th>
                  <th className="px-4 py-3 font-semibold">{isRtl ? 'النوع' : 'Type'}</th>
                  <th className="px-4 py-3 text-center font-semibold">{isRtl ? 'الحركات' : 'Transactions'}</th>
                  <th className="px-4 py-3 text-right font-semibold">{isRtl ? 'مدين' : 'Debit'}</th>
                  <th className="px-4 py-3 text-right font-semibold">{isRtl ? 'دائن' : 'Credit'}</th>
                  <th className="px-4 py-3 text-right font-semibold">{isRtl ? 'الرصيد' : 'Balance'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map((row) => (
                  <tr
                    key={`${row.accountType}-${row.party}`}
                    onDoubleClick={() => setSelectedAccount(row)}
                    className="cursor-pointer hover:bg-slate-50"
                    title={isRtl ? 'انقر مرتين لفتح دفتر الحساب' : 'Double-click to open account ledger'}
                  >
                    <td className="px-4 py-3 font-semibold text-slate-800">{row.party}</td>
                    <td className="px-4 py-3 text-slate-600">{row.accountType}</td>
                    <td className="px-4 py-3 text-center text-slate-600">{row.transactions}</td>
                    <td className="px-4 py-3 text-right font-mono">{currency}{row.debit.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-700">{currency}{row.credit.toFixed(2)}</td>
                    <td className={`px-4 py-3 text-right font-mono font-bold ${balanceClass(row.balance)}`}>{currency}{row.balance.toFixed(2)}</td>
                  </tr>
                ))}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                      {isRtl ? 'لا توجد حسابات مطابقة' : 'No matching accounts'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
          </>
        )}
      </div>
    </div>
  );
};
