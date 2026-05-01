export function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function formatAED(amount: number): string {
  return `AED ${roundCurrency(amount).toFixed(2)}`;
}
