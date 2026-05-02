export type TransactionType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'TRANSFER'
  | 'RECEIVE'
  | 'CASHBACK'
  | 'FEE'
  | 'REFERRAL_REWARD'
  | 'SAVINGS_TRANSFER'
  | 'CARD_PURCHASE'
  | 'PAYROLL'
  | 'REMITTANCE'
  | 'REFUND';

export type TransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED';

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  fee: number;
  totalAmount: number;
  currency?: string;
  status: TransactionStatus;
  description?: string | null;
  merchantName?: string | null;
  counterpartyPhone?: string | null;
  createdAt: string;
}
