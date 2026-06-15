import apiClient from './client';

/**
 * UAE biller union — mirrors the backend `BillerType` Prisma enum.
 * Keep in lock-step. The mobile boundary refuses any other value at
 * the form layer (the picker only emits these).
 */
export type BillerType =
  | 'DEWA'
  | 'SEWA'
  | 'ADDC'
  | 'FEWA'
  | 'ETISALAT'
  | 'DU'
  | 'SALIK'
  | 'RTA'
  | 'OTHER';

export type BillPaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED';

export interface BillPayment {
  id: string;
  billerType: BillerType;
  billerAccountRef: string;
  amount: number;
  fee: number;
  totalAmount: number;
  currency: string;
  status: BillPaymentStatus;
  failureReason: string | null;
  externalRef: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface PayBillRequest {
  billerType: BillerType;
  billerAccountRef: string;
  amount: number;
  /** Client-generated UUID. Re-used across retries to dedupe. */
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface PayBillResponse {
  bill: BillPayment;
}

export interface ListBillsResponse {
  bills: BillPayment[];
  pagination: { limit: number; offset: number; total: number };
}

export const billsService = {
  async listBills(params: { limit?: number; offset?: number } = {}): Promise<ListBillsResponse> {
    const { data } = await apiClient.get<ListBillsResponse>('/bills', { params });
    return data;
  },

  async payBill(req: PayBillRequest): Promise<PayBillResponse> {
    const { idempotencyKey, ...body } = req;
    const { data } = await apiClient.post<PayBillResponse>('/bills/pay', body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return data;
  },
};
