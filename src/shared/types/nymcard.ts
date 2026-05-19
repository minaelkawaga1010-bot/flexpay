export interface NymCardCustomer {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export interface NymCardCard {
  cardId: string;
  customerId: string;
  last4: string;
  brand: string;
  expiryMonth: number;
  expiryYear: number;
  type: 'VIRTUAL' | 'PHYSICAL';
}

export interface NymCardAddress {
  street: string;
  city: string;
  country: string;
  postalCode: string;
  emirate?: string;
}

export type WalletType = 'APPLE_PAY' | 'GOOGLE_PAY';

export interface NymCardTransactionWebhook {
  cardId: string;
  customerId: string;
  amount: number;
  currency: string;
  merchantName: string;
  merchantCategory: string;
  transactionId: string;
  timestamp: string;
}

export interface NymCardShippingWebhook {
  cardId: string;
  trackingNumber: string;
  status: 'PENDING' | 'SHIPPED' | 'DELIVERED' | 'RETURNED';
  carrier?: string;
}
