import type { Sale } from '../types/pos';

export function getSaleAppliedPayment(
  sale: Pick<Sale, 'total' | 'amountTendered'>
): number {
  const total = Number.isFinite(sale.total) ? Math.max(0, sale.total) : 0;
  const tendered = Number.isFinite(sale.amountTendered)
    ? Math.max(0, sale.amountTendered)
    : 0;
  return Math.min(total, tendered);
}

export function getSaleBalanceDue(
  sale: Pick<Sale, 'total' | 'amountTendered' | 'returnedTotal'>
): number {
  const total = Number.isFinite(sale.total) ? Math.max(0, sale.total) : 0;
  const returned = Number.isFinite(sale.returnedTotal)
    ? Math.max(0, sale.returnedTotal ?? 0)
    : 0;
  return Math.max(0, Number((total - getSaleAppliedPayment(sale) - returned).toFixed(2)));
}

export function allocatePaymentAcrossServices(amount: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const amountCents = Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
  const weightsCents = weights.map((weight) =>
    Number.isFinite(weight) ? Math.max(0, Math.round(weight * 100)) : 0
  );
  const totalWeightCents = weightsCents.reduce((sum, weight) => sum + weight, 0);
  if (totalWeightCents === 0) {
    const eachAmount = Math.floor(amountCents / weights.length);
    const remainingCents = amountCents % weights.length;
    return weights.map((_, index) => (eachAmount + (index < remainingCents ? 1 : 0)) / 100);
  }

  const allocations = weightsCents.map((weight, index) => {
    const exactCents = (amountCents * weight) / totalWeightCents;
    return { index, cents: Math.floor(exactCents), fraction: exactCents % 1 };
  });
  const remainingCents = amountCents - allocations.reduce((sum, item) => sum + item.cents, 0);
  const remainderOrder = [...allocations].sort((left, right) =>
    right.fraction - left.fraction || left.index - right.index
  );
  for (let index = 0; index < remainingCents; index += 1) {
    allocations[remainderOrder[index % remainderOrder.length].index].cents += 1;
  }
  return allocations
    .sort((left, right) => left.index - right.index)
    .map((item) => item.cents / 100);
}
