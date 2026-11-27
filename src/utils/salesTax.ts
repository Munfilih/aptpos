import type { Sale, TaxType } from '../types/pos';

export interface TaxableLine {
  amount: number;
  taxRate: number;
}

export interface TaxedLine {
  discountAmount: number;
  subtotal: number;
  taxAmount: number;
  total: number;
}

export interface SalesTaxBreakdown {
  subtotal: number;
  taxAmount: number;
  total: number;
  lines: TaxedLine[];
}

export interface SalesTaxCategorySummary {
  rate: number;
  taxableAmount: number;
  taxAmount: number;
}

function toCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

export function calculateSalesTax(
  lines: TaxableLine[],
  discountAmount: number,
  taxType: TaxType
): SalesTaxBreakdown {
  const amounts = lines.map((line) => Math.max(0, toCents(line.amount)));
  const grossCents = amounts.reduce((sum, amount) => sum + amount, 0);
  const discountCents = Math.min(grossCents, Math.max(0, toCents(discountAmount)));
  const exactDiscounts = amounts.map((amount) =>
    grossCents > 0 ? (amount * discountCents) / grossCents : 0
  );
  const discounts = exactDiscounts.map(Math.floor);
  let remainingDiscount = discountCents - discounts.reduce((sum, amount) => sum + amount, 0);
  const remainderOrder = exactDiscounts
    .map((amount, index) => ({ index, fraction: amount - discounts[index] }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let index = 0; index < remainingDiscount; index += 1) {
    discounts[remainderOrder[index].index] += 1;
  }

  const taxedLines = lines.map((line, index) => {
    const netCents = amounts[index] - discounts[index];
    const rate = Number.isFinite(line.taxRate) ? Math.min(100, Math.max(0, line.taxRate)) : 0;
    const lineTaxCents = taxType === 'inclusive'
      ? Math.round(netCents - netCents / (1 + rate / 100))
      : Math.round((netCents * rate) / 100);
    const subtotalCents = taxType === 'inclusive' ? netCents - lineTaxCents : netCents;
    const totalCents = taxType === 'inclusive' ? netCents : netCents + lineTaxCents;
    return {
      discountAmount: discounts[index] / 100,
      subtotal: subtotalCents / 100,
      taxAmount: lineTaxCents / 100,
      total: totalCents / 100,
    };
  });

  return {
    subtotal: Number(taxedLines.reduce((sum, line) => sum + line.subtotal, 0).toFixed(2)),
    taxAmount: Number(taxedLines.reduce((sum, line) => sum + line.taxAmount, 0).toFixed(2)),
    total: Number(taxedLines.reduce((sum, line) => sum + line.total, 0).toFixed(2)),
    lines: taxedLines,
  };
}

export function getSalesTaxCategorySummaries(
  lines: TaxableLine[],
  breakdown: SalesTaxBreakdown
): SalesTaxCategorySummary[] {
  const categories = new Map<number, SalesTaxCategorySummary>();
  lines.forEach((line, index) => {
    const rate = Number.isFinite(line.taxRate)
      ? Math.min(100, Math.max(0, line.taxRate))
      : 0;
    const summary = categories.get(rate) || { rate, taxableAmount: 0, taxAmount: 0 };
    summary.taxableAmount += breakdown.lines[index].subtotal;
    summary.taxAmount += breakdown.lines[index].taxAmount;
    categories.set(rate, summary);
  });
  return [...categories.values()]
    .sort((a, b) => a.rate - b.rate)
    .map((category) => ({
      ...category,
      taxableAmount: Number(category.taxableAmount.toFixed(2)),
      taxAmount: Number(category.taxAmount.toFixed(2)),
    }));
}

export function getPrintedSalesTaxBreakdown(
  sale: Pick<Sale, 'items' | 'subtotal' | 'taxAmount' | 'taxRate' | 'taxType' | 'discountAmount'>,
  fallbackTaxType: TaxType
): Pick<SalesTaxBreakdown, 'subtotal' | 'taxAmount'> {
  const hasLegacyZeroRatedLine = !sale.taxType &&
    sale.items.some((item) => item.taxRate === 0);
  if (sale.items.length === 0 || (!sale.taxType && !hasLegacyZeroRatedLine)) {
    return { subtotal: sale.subtotal, taxAmount: sale.taxAmount };
  }

  const breakdown = calculateSalesTax(
    sale.items.map((item) => ({
      amount: item.lineTotal,
      taxRate: item.taxRate ?? sale.taxRate,
    })),
    sale.discountAmount,
    fallbackTaxType
  );
  return { subtotal: breakdown.subtotal, taxAmount: breakdown.taxAmount };
}

export function getSaleTaxRateLabel(sale: Pick<Sale, 'taxRate' | 'items'>): string {
  const rates = [...new Set(
    sale.items
      .map((item) => item.taxRate ?? sale.taxRate)
      .filter((rate) => Number.isFinite(rate))
  )].sort((a, b) => a - b);
  return rates.length > 0 ? `${rates.join(', ')}%` : `${sale.taxRate}%`;
}

export function getTaxExcludedUnitPrice(
  unitPrice: number,
  quantity: number,
  taxType: TaxType,
  taxRate?: number,
  taxAmount?: number
): number {
  const safeUnitPrice = Number(unitPrice) || 0;
  if (taxType !== 'inclusive') return safeUnitPrice;
  const rate = typeof taxRate === 'number' && Number.isFinite(taxRate)
    ? Math.min(100, Math.max(0, taxRate))
    : undefined;
  if (rate !== undefined && rate > 0) {
    return safeUnitPrice / (1 + rate / 100);
  }
  if (rate === 0) {
    return safeUnitPrice;
  }
  const safeTaxAmount = typeof taxAmount === 'number' && Number.isFinite(taxAmount) ? taxAmount : 0;
  if (safeTaxAmount > 0) {
    return Math.max(0, safeUnitPrice - safeTaxAmount / Math.max(1, Number(quantity) || 1));
  }
  return safeUnitPrice;
}
