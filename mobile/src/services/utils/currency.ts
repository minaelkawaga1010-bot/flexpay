export function formatAED(amount: number, opts: { showSign?: boolean } = {}): string {
  const sign = opts.showSign && amount > 0 ? '+' : '';
  const abs = Math.abs(amount);
  return `${sign}AED ${abs.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatCardExpiry(month: number, year: number): string {
  const mm = String(month).padStart(2, '0');
  const yy = String(year).slice(-2);
  return `${mm}/${yy}`;
}

export function maskCardNumber(last4: string): string {
  return `•••• •••• •••• ${last4}`;
}
