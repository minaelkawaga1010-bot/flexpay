/**
 * Single source of truth for event names. Keeping them typed prevents the
 * usual analytics drift (typos, casing, near-duplicates).
 */
export const EVENTS = {
  // Auth
  OTP_REQUESTED: 'otp_requested',
  OTP_RESENT: 'otp_resent',
  AUTH_SUCCESS: 'auth_success',

  // Wallet
  TRANSFER_INITIATED: 'transfer_initiated',
  TRANSFER_SUCCESS: 'transfer_success',
  TRANSFER_FAILED: 'transfer_failed',

  // Cards
  PHYSICAL_CARD_ORDERED: 'physical_card_ordered',
  CARD_TOKENIZED: 'card_tokenized',

  // Engagement
  OFFER_CLICKED: 'offer_clicked',
  SAVINGS_GOAL_CREATED: 'savings_goal_created',
  EWA_REQUESTED: 'ewa_requested',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
