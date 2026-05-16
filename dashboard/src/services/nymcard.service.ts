/**
 * NymCard Service -- Complete TypeScript wrapper for the NymCard virtual/physical
 * card issuing API.  Handles card lifecycle, tokenisation, funding, transactions
 * and webhook verification.
 *
 * @module services/nymcard.service
 */

import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// Custom Error
// ---------------------------------------------------------------------------

export class NymCardAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "NymCardAPIError";
  }
}

// ---------------------------------------------------------------------------
// Interfaces -- Config
// ---------------------------------------------------------------------------

export interface NymCardConfig {
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
  webhookSecret: string;
  timeout: number;
}

// ---------------------------------------------------------------------------
// Interfaces -- Customer
// ---------------------------------------------------------------------------

export interface CreateCustomerRequest {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  nationality: string;
  idType: "passport" | "national_id" | "emirates_id";
  idNumber: string;
  idExpiry: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
  occupation?: string;
  employer?: string;
  estimatedIncome?: number;
}

export interface CustomerResponse {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  nationality: string;
  idType: "passport" | "national_id" | "emirates_id";
  idNumber: string;
  idExpiry: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
  occupation?: string;
  employer?: string;
  estimatedIncome?: number;
  status: "ACTIVE" | "SUSPENDED" | "CLOSED";
  kycLevel: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Interfaces -- Cards (Virtual & Physical)
// ---------------------------------------------------------------------------

export type CardType = "VIRTUAL" | "PHYSICAL";
export type CardBrand = "VISA" | "MASTERCARD";
export type CardStatus =
  | "ACTIVE"
  | "FROZEN"
  | "BLOCKED"
  | "EXPIRED"
  | "PENDING"
  | "CANCELLED"
  | "ISSUED";

export type PhysicalCardStatus =
  | "ORDERED"
  | "PRINTING"
  | "SHIPPED"
  | "DELIVERED"
  | "ACTIVATED"
  | "FAILED";

export interface IssueVirtualCardRequest {
  customerId: string;
  cardType: CardType;
  brand: CardBrand;
  currency: string;
  nameOnCard: string;
  expiryMonths?: number;
  shippingAddress?: ShippingAddress;
}

export interface IssuePhysicalCardRequest {
  customerId: string;
  brand: CardBrand;
  currency: string;
  nameOnCard: string;
  expiryMonths?: number;
  shippingAddress: ShippingAddress;
  fastTrack?: boolean;
}

export interface ShippingAddress {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
  recipientName: string;
  recipientPhone: string;
}

export interface CardResponse {
  id: string;
  customerId: string;
  type: CardType;
  brand: CardBrand;
  currency: string;
  nameOnCard: string;
  last4: string;
  status: CardStatus;
  expiryMonth: number;
  expiryYear: number;
  frozen: boolean;
  spendLimitDaily: number;
  spendLimitMonthly: number;
  spendLimitPerTx: number;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface CardSensitiveResponse extends CardResponse {
  pan: string;
  cvv: string;
  fullExpiry: string;
}

// ---------------------------------------------------------------------------
// Interfaces -- Limits & Controls
// ---------------------------------------------------------------------------

export type CardChannel = "ATM" | "POS" | "ECOM" | "MOTO" | "CONTACTLESS";

export interface UpdateCardLimitsRequest {
  dailyLimit?: number;
  monthlyLimit?: number;
  perTransactionLimit?: number;
}

export interface ChannelLimits {
  enabled: boolean;
  dailyLimit?: number;
  monthlyLimit?: number;
  perTransactionLimit?: number;
}

// ---------------------------------------------------------------------------
// Interfaces -- Tokenisation (Apple Pay / Google Pay)
// ---------------------------------------------------------------------------

export type TokenType = "APPLE_PAY" | "GOOGLE_PAY" | "SAMSUNG_PAY";

export interface TokenizeCardRequest {
  tokenType: TokenType;
  tokenData: string;
  publicKeyHash?: string;
}

export interface TokenizeCardResponse {
  tokenId: string;
  cardId: string;
  tokenType: TokenType;
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
  network: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Interfaces -- Funding & Transfer
// ---------------------------------------------------------------------------

export interface FundingRequest {
  amount: number;
  currency: string;
  reference?: string;
  description?: string;
}

export interface FundingResponse {
  id: string;
  cardId: string;
  amount: number;
  currency: string;
  reference: string;
  status: "COMPLETED" | "PENDING" | "FAILED";
  createdAt: string;
}

export interface TransferRequest {
  sourceCardId: string;
  destinationCardId: string;
  amount: number;
  currency: string;
  description?: string;
}

export interface TransferResponse {
  id: string;
  sourceCardId: string;
  destinationCardId: string;
  amount: number;
  currency: string;
  status: "COMPLETED" | "PENDING" | "FAILED";
  reference: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Interfaces -- Transactions
// ---------------------------------------------------------------------------

export type TransactionDirection = "DEBIT" | "CREDIT";
export type TransactionStatus = "COMPLETED" | "PENDING" | "DECLINED" | "REVERSED";
export type TransactionChannel = "ATM" | "POS" | "ECOM" | "P2P" | "FUNDING" | "WITHDRAWAL";

export interface CardTransaction {
  id: string;
  cardId: string;
  amount: number;
  currency: string;
  direction: TransactionDirection;
  status: TransactionStatus;
  channel: TransactionChannel;
  merchantName: string;
  merchantCategoryCode: string;
  merchantCountry?: string;
  reference: string;
  description?: string;
  authorizationCode?: string;
  createdAt: string;
  settledAt?: string;
}

// ---------------------------------------------------------------------------
// Interfaces -- Freeze
// ---------------------------------------------------------------------------

export interface FreezeCardRequest {
  reason?: string;
}

// ---------------------------------------------------------------------------
// Interfaces -- Webhooks
// ---------------------------------------------------------------------------

export type WebhookEventType =
  | "card.created"
  | "card.frozen"
  | "card.unfrozen"
  | "card.blocked"
  | "card.expired"
  | "card.transaction"
  | "card.funding"
  | "card.limits_updated"
  | "customer.created"
  | "customer.updated"
  | "customer.suspended"
  | "token.created"
  | "token.deleted";

export interface WebhookPayload {
  id: string;
  eventType: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
  signature: string;
}

// ---------------------------------------------------------------------------
// Internal request helper types
// ---------------------------------------------------------------------------

interface InternalRequestConfig {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  params?: Record<string, string | number | undefined>;
  idempotencyKey?: string;
}

// ---------------------------------------------------------------------------
// NymCardService
// ---------------------------------------------------------------------------

export class NymCardService {
  private config: NymCardConfig;

  constructor(config?: Partial<NymCardConfig>) {
    this.config = {
      apiUrl: config?.apiUrl ?? process.env.NYMCARD_API_URL ?? "https://sandbox.api.nymcard.com/v1",
      apiKey: config?.apiKey ?? process.env.NYMCARD_API_KEY ?? "",
      apiSecret: config?.apiSecret ?? process.env.NYMCARD_API_SECRET ?? "",
      webhookSecret: config?.webhookSecret ?? process.env.NYMCARD_WEBHOOK_SECRET ?? "",
      timeout: config?.timeout ?? 30_000,
    };
  }

  // -- Authentication -------------------------------------------------------------

  /**
   * Generate the HMAC-SHA256 authentication signature and return an
   * Authorization: Basic <base64(key:signature)> header value.
   *
   * Signature payload = timestamp + method + path + (body or "")
   */
  private generateAuthHeader(
    method: string,
    path: string,
    body: string,
  ): string {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = `${timestamp}${method.toUpperCase()}${path}${body}`;
    const signature = crypto
      .createHmac("sha256", this.config.apiSecret)
      .update(payload)
      .digest("hex");

    const credentials = `${this.config.apiKey}:${signature}`;
    const encoded = Buffer.from(credentials).toString("base64");

    return `Basic ${encoded}`;
  }

  /**
   * Core HTTP request method wrapping native fetch with auth, idempotency,
   * error handling and logging.
   */
  private async request<T>(
    method: InternalRequestConfig["method"],
    path: string,
    body?: unknown,
    params?: Record<string, string | number | undefined>,
  ): Promise<T> {
    let url = `${this.config.apiUrl}${path}`;

    // Append query params
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          searchParams.set(key, String(value));
        }
      }
      const qs = searchParams.toString();
      if (qs) url += `?${qs}`;
    }

    const bodyStr = body ? JSON.stringify(body) : "";
    const isMutation = method !== "GET" && method !== "DELETE";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: this.generateAuthHeader(method, path, bodyStr),
    };

    // Idempotency key for POST / PATCH / PUT
    if (isMutation) {
      headers["X-Idempotency-Key"] = uuidv4();
    }

    // Debug logging
    if (process.env.NODE_ENV === "development") {
      console.debug(`[NymCard] -> ${method} ${url}`);
      if (bodyStr) console.debug(`[NymCard]   Body: ${bodyStr}`);
    }

    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers,
        body: bodyStr || undefined,
        signal: AbortSignal.timeout(this.config.timeout),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      console.error(`[NymCard] x ${method} ${url} -- ${message}`);
      throw new NymCardAPIError(message, 0, "NETWORK_ERROR");
    }

    // Parse response
    let data: unknown;
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();

    if (contentType.includes("application/json")) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    } else {
      data = text;
    }

    if (process.env.NODE_ENV === "development") {
      console.debug(`[NymCard] <- ${response.status} ${url}`);
    }

    // Error handling
    if (!response.ok) {
      const apiData = data as Record<string, unknown> | undefined;
      const errorBody = (apiData as Record<string, Record<string, unknown>>)?.error ?? apiData;

      const code = String((errorBody as Record<string, unknown>)?.code ?? this.mapStatusCode(response.status));
      const message = String(
        (errorBody as Record<string, unknown>)?.message ?? this.mapStatusMessage(response.status),
      );
      const details = (errorBody as Record<string, unknown>)?.details as Record<string, unknown> | undefined;

      console.error(`[NymCard] x ${response.status} ${method} ${url} -- ${message}`);

      throw new NymCardAPIError(message, response.status, code, details);
    }

    return data as T;
  }

  /** Map HTTP status code to a human-friendly error code. */
  private mapStatusCode(status: number): string {
    const map: Record<number, string> = {
      400: "BAD_REQUEST",
      401: "AUTH_FAILED",
      403: "FORBIDDEN",
      404: "NOT_FOUND",
      409: "CONFLICT",
      422: "VALIDATION_ERROR",
      429: "RATE_LIMITED",
    };
    return map[status] ?? "API_ERROR";
  }

  /** Map HTTP status code to a human-readable message. */
  private mapStatusMessage(status: number): string {
    const map: Record<number, string> = {
      400: "Invalid request",
      401: "Authentication failed",
      403: "Access denied",
      404: "Resource not found",
      409: "Conflict (duplicate)",
      422: "Validation error",
      429: "Rate limited - too many requests",
    };
    if (status >= 500) return "NymCard API error";
    return map[status] ?? "Unexpected error";
  }

  // -- Customer Management ------------------------------------------------------

  async createCustomer(data: CreateCustomerRequest): Promise<CustomerResponse> {
    return this.request<CustomerResponse>("POST", "/customers", data);
  }

  async getCustomer(customerId: string): Promise<CustomerResponse> {
    return this.request<CustomerResponse>("GET", `/customers/${customerId}`);
  }

  async updateCustomer(
    customerId: string,
    data: Partial<CreateCustomerRequest>,
  ): Promise<CustomerResponse> {
    return this.request<CustomerResponse>("PATCH", `/customers/${customerId}`, data);
  }

  // -- Virtual Card Management --------------------------------------------------

  async issueVirtualCard(data: IssueVirtualCardRequest): Promise<CardResponse> {
    return this.request<CardResponse>("POST", "/cards/virtual", data);
  }

  async getCard(cardId: string): Promise<CardResponse> {
    return this.request<CardResponse>("GET", `/cards/${cardId}`);
  }

  async listCards(customerId: string): Promise<CardResponse[]> {
    return this.request<CardResponse[]>("GET", "/cards", { customerId });
  }

  async getCardSensitiveData(cardId: string): Promise<CardSensitiveResponse> {
    return this.request<CardSensitiveResponse>("GET", `/cards/${cardId}/sensitive`);
  }

  async freezeCard(cardId: string, data?: FreezeCardRequest): Promise<CardResponse> {
    return this.request<CardResponse>("POST", `/cards/${cardId}/freeze`, data);
  }

  async unfreezeCard(cardId: string): Promise<CardResponse> {
    return this.request<CardResponse>("POST", `/cards/${cardId}/unfreeze`);
  }

  async blockCard(cardId: string): Promise<CardResponse> {
    return this.request<CardResponse>("POST", `/cards/${cardId}/block`);
  }

  // -- Physical Cards -----------------------------------------------------------

  async issuePhysicalCard(data: IssuePhysicalCardRequest): Promise<CardResponse> {
    return this.request<CardResponse>("POST", "/cards/physical", data);
  }

  async getPhysicalCardStatus(cardId: string): Promise<CardResponse> {
    return this.request<CardResponse>("GET", `/cards/physical/${cardId}/status`);
  }

  // -- Limits & Controls --------------------------------------------------------

  async updateCardLimits(
    cardId: string,
    data: UpdateCardLimitsRequest,
  ): Promise<CardResponse> {
    return this.request<CardResponse>("PATCH", `/cards/${cardId}/limits`, data);
  }

  async setCardChannelLimits(
    cardId: string,
    channel: string,
    limits: ChannelLimits,
  ): Promise<CardResponse> {
    return this.request<CardResponse>(
      "PATCH",
      `/cards/${cardId}/channels/${channel}`,
      limits,
    );
  }

  // -- Tokenisation (Apple Pay / Google Pay) ------------------------------------

  async tokenizeCard(
    cardId: string,
    data: TokenizeCardRequest,
  ): Promise<TokenizeCardResponse> {
    return this.request<TokenizeCardResponse>("POST", `/cards/${cardId}/tokens`, data);
  }

  async detokenizeCard(cardId: string, tokenId: string): Promise<void> {
    await this.request<void>("DELETE", `/cards/${cardId}/tokens/${tokenId}`);
  }

  // -- Funding ------------------------------------------------------------------

  async fundCard(cardId: string, data: FundingRequest): Promise<FundingResponse> {
    return this.request<FundingResponse>("POST", `/cards/${cardId}/fund`, data);
  }

  async getCardBalance(
    cardId: string,
  ): Promise<{ available: number; ledger: number; currency: string }> {
    return this.request<{ available: number; ledger: number; currency: string }>(
      "GET",
      `/cards/${cardId}/balance`,
    );
  }

  // -- Transfers ----------------------------------------------------------------

  async transferBetweenCards(data: TransferRequest): Promise<TransferResponse> {
    return this.request<TransferResponse>("POST", "/cards/transfer", data);
  }

  // -- Transactions -------------------------------------------------------------

  async getCardTransactions(
    cardId: string,
    params?: { from?: string; to?: string; limit?: number },
  ): Promise<CardTransaction[]> {
    return this.request<CardTransaction[]>(
      "GET",
      `/cards/${cardId}/transactions`,
      undefined,
      {
        from: params?.from,
        to: params?.to,
        limit: params?.limit,
      },
    );
  }

  // -- Webhook Verification -----------------------------------------------------

  /**
   * Verify that a webhook payload was genuinely sent by NymCard.
   *
   * Uses constant-time comparison (timingSafeEqual) to prevent timing attacks.
   *
   * @param rawBody  - The exact raw request body (string)
   * @param signature - Value of the X-NymCard-Signature header
   * @returns true when the signature matches
   */
  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    if (!this.config.webhookSecret) {
      console.error("[NymCard] Webhook secret is not configured");
      return false;
    }

    try {
      const expected = crypto
        .createHmac("sha256", this.config.webhookSecret)
        .update(rawBody, "utf8")
        .digest("hex");

      const expectedBuf = Buffer.from(expected, "utf8");
      const receivedBuf = Buffer.from(signature, "utf8");

      if (expectedBuf.length !== receivedBuf.length) return false;

      return crypto.timingSafeEqual(expectedBuf, receivedBuf);
    } catch {
      console.error("[NymCard] Failed to verify webhook signature");
      return false;
    }
  }

  /**
   * Parse a webhook payload string into a typed WebhookPayload object.
   *
   * Does NOT verify the signature -- call verifyWebhookSignature first.
   */
  parseWebhookEvent(payload: string): WebhookPayload {
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;

      return {
        id: String(parsed.id ?? ""),
        eventType: String(parsed.eventType ?? "unknown") as WebhookEventType,
        timestamp: String(parsed.timestamp ?? new Date().toISOString()),
        data: (parsed.data as Record<string, unknown>) ?? {},
        signature: String(parsed.signature ?? ""),
      };
    } catch {
      throw new NymCardAPIError(
        "Invalid webhook payload - cannot parse JSON",
        400,
        "INVALID_WEBHOOK_PAYLOAD",
      );
    }
  }

  // -- Static Utilities ---------------------------------------------------------

  /**
   * Mask a card number showing only the last 4 digits.
   *
   * @example maskCardNumber("4111222233334444") returns "**** **** **** 4444"
   */
  static maskCardNumber(cardNumber: string): string {
    const digits = cardNumber.replace(/\D/g, "");
    const last4 = digits.slice(-4);
    return `**** **** **** ${last4}`;
  }

  /**
   * Format expiry month & year as "MM/YY".
   *
   * @example formatExpiry(12, 2028) returns "12/28"
   */
  static formatExpiry(month: number, year: number): string {
    const mm = String(month).padStart(2, "0");
    const yy = String(year).slice(-2);
    return `${mm}/${yy}`;
  }

  /**
   * Check whether a card has expired based on its expiry month/year.
   */
  static isCardExpired(month: number, year: number): boolean {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-indexed

    if (year < currentYear) return true;
    if (year === currentYear && month < currentMonth) return true;
    return false;
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const nymcardService = new NymCardService();

export default NymCardService;
