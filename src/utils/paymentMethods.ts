import type { PaymentMethod } from '../types/pos';

export const BUILT_IN_PAYMENT_METHODS = ['Cash', 'Card', 'Split'] as const;

export function getPaymentMethods(configuredMethods?: readonly string[]): PaymentMethod[] {
  const methods: PaymentMethod[] = [];
  const seen = new Set<string>();

  for (const name of [...BUILT_IN_PAYMENT_METHODS, ...(configuredMethods || [])]) {
    const method = name.trim();
    const key = method.toLowerCase();
    if (method && !seen.has(key)) {
      methods.push(method);
      seen.add(key);
    }
  }

  return methods;
}
