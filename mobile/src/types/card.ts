export type CardType = 'VIRTUAL' | 'PHYSICAL';
export type CardStatus = 'ACTIVE' | 'INACTIVE' | 'BLOCKED' | 'EXPIRED' | 'REPLACED';

export interface Card {
  id: string;
  type: CardType;
  status: CardStatus;
  last4: string;
  brand: string;
  expiryMonth: number;
  expiryYear: number;
  shippingStatus?: string | null;
  trackingNumber?: string | null;
  createdAt: string;
}
