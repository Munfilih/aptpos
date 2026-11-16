export function getKotNumberFromInvoice(invoiceNumber: string): string {
  return invoiceNumber.match(/(\d+)$/)?.[1] ?? invoiceNumber;
}
