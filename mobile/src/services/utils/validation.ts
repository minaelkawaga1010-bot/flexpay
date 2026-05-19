export function validatePhone(phone: string): boolean {
  // E.164, supports any country code; UI hint shows UAE.
  return /^\+\d{8,15}$/.test(phone.replace(/\s/g, ''));
}

export function validateUaePhone(phone: string): boolean {
  return /^\+9715[0-9]{8}$/.test(phone.replace(/\s/g, ''));
}

export function validateAmount(amount: string | number): boolean {
  const n = typeof amount === 'number' ? amount : parseFloat(amount);
  return Number.isFinite(n) && n > 0;
}

export function validateOTP(otp: string): boolean {
  return /^\d{6}$/.test(otp);
}
