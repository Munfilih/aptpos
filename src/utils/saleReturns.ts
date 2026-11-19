import type { Sale } from '../types/pos';

export interface SaleReturnAllocation {
  saleItemId: number;
  quantity: number;
  refundAmount: number;
}

export function calculateSaleReturnRefund(
  sale: Pick<Sale, 'total' | 'items' | 'taxType'>,
  requestedItems: Array<{ saleItemId: number; quantity: number }>,
  previouslyRefunded: number
): { total: number; allocations: SaleReturnAllocation[] } {
  const grossTotal = sale.items.reduce((sum, item) => sum + item.lineTotal, 0);
  const byId = new Map(sale.items.map((item) => [item.id, item]));
  const allocations = requestedItems.map(({ saleItemId, quantity }) => {
    const item = byId.get(saleItemId);
    const itemTaxableTotal = item &&
      item.taxAmount !== undefined &&
      item.discountAmount !== undefined &&
      sale.taxType
      ? Math.max(0, item.lineTotal - item.discountAmount) +
        (sale.taxType === 'exclusive' ? item.taxAmount : 0)
      : null;
    const amount =
      item && itemTaxableTotal !== null && item.quantity > 0
        ? (itemTaxableTotal * quantity) / item.quantity
        : item && grossTotal > 0
          ? (sale.total * item.lineTotal * quantity) / (grossTotal * item.quantity)
        : 0;
    return {
      saleItemId,
      quantity,
      refundCents: Math.round((amount + Number.EPSILON) * 100),
    };
  });

  const isFullReturn = sale.items.every((item) => {
    const requestedQuantity =
      requestedItems.find((requested) => requested.saleItemId === item.id)?.quantity || 0;
    return (item.returnedQuantity || 0) + requestedQuantity >= item.quantity;
  });
  const refundLimitCents = Math.max(
    0,
    Math.round((sale.total - previouslyRefunded + Number.EPSILON) * 100)
  );

  if (allocations.length > 0) {
    let allocatedCents = allocations.reduce((sum, allocation) => sum + allocation.refundCents, 0);
    if (isFullReturn && allocatedCents < refundLimitCents) {
      allocations[allocations.length - 1].refundCents += refundLimitCents - allocatedCents;
      allocatedCents = refundLimitCents;
    }

    let excessCents = Math.max(0, allocatedCents - refundLimitCents);
    for (let index = allocations.length - 1; index >= 0 && excessCents > 0; index -= 1) {
      const reduction = Math.min(allocations[index].refundCents, excessCents);
      allocations[index].refundCents -= reduction;
      excessCents -= reduction;
    }
  }

  return {
    total: allocations.reduce((sum, allocation) => sum + allocation.refundCents, 0) / 100,
    allocations: allocations.map(({ saleItemId, quantity, refundCents }) => ({
      saleItemId,
      quantity,
      refundAmount: refundCents / 100,
    })),
  };
}
