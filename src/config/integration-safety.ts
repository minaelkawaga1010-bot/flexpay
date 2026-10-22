import { checkSecretStrength, type JwtSecretProblem } from './jwt-secret-policy';

/**
 * Integration safety policy (TASK-007).
 *
 *  1. Webhook credentials. Every provider webhook needs explicitly
 *     configured, strong credentials. Missing or weak values make that
 *     endpoint refuse every request (fail closed) in EVERY environment —
 *     there is no development or staging bypass.
 *  2. Production. The process must not start while any integration that
 *     can move or affect real money runs in stub, sandbox or bypass mode.
 *
 * Pure functions over a config object, so env.ts (startup) and the
 * webhook verifiers (request time) share one source of truth. Messages
 * name the variable and the rule — never a value.
 */

/** Provider-issued HMAC keys (length is the provider's choice). */
export const MIN_PROVIDER_SECRET_LENGTH = 16;
/** Basic-Auth password we generate when registering the NymCard webhook. */
export const MIN_BASIC_PASSWORD_LENGTH = 32;

export type WebhookProvider = 'nymcard' | 'moneyhash' | 'flexxpay' | 'biller';

export interface IntegrationConfig {
  NYMCARD_API_KEY?: string;
  NYMCARD_API_BASE?: string;
  NYMCARD_WEBHOOK_BASIC_USER?: string;
  NYMCARD_WEBHOOK_BASIC_PASSWORD?: string;
  NYMCARD_WEBHOOK_HEADER_NAME?: string;
  NYMCARD_WEBHOOK_HEADER_VALUE?: string;
  MONEYHASH_API_KEY?: string;
  MONEYHASH_API_BASE?: string;
  MONEYHASH_WEBHOOK_SECRET?: string;
  FLEXXPAY_API_KEY?: string;
  FLEXXPAY_API_BASE?: string;
  FLEXXPAY_WEBHOOK_SECRET?: string;
  BILLER_WEBHOOK_SECRET?: string;
  MOHRE_API_BASE?: string;
  MOHRE_API_KEY?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_PHONE_NUMBER?: string;
}

const RULES: Record<Exclude<JwtSecretProblem, 'too_short'>, string> = {
  missing: 'is required and has no default',
  known_compromised: 'is a publicly known value — generate a new one',
  placeholder: 'looks like a placeholder',
  low_variety: 'has too little character variety',
};

function secretIssue(variable: string, value: string | undefined, minLength: number): string | null {
  const problem = checkSecretStrength(value, minLength);
  if (!problem) return null;
  if (problem === 'too_short') return `${variable} must be at least ${minLength} characters`;
  return `${variable} ${RULES[problem]}`;
}

const HMAC_SECRET_VARIABLE = {
  moneyhash: 'MONEYHASH_WEBHOOK_SECRET',
  flexxpay: 'FLEXXPAY_WEBHOOK_SECRET',
  biller: 'BILLER_WEBHOOK_SECRET',
} as const;

/** Problems that make a provider's webhook refuse every request. */
export function webhookCredentialIssues(provider: WebhookProvider, cfg: IntegrationConfig): string[] {
  if (provider !== 'nymcard') {
    const variable = HMAC_SECRET_VARIABLE[provider];
    const issue = secretIssue(variable, cfg[variable], MIN_PROVIDER_SECRET_LENGTH);
    return issue ? [issue] : [];
  }

  const issues: string[] = [];
  const user = cfg.NYMCARD_WEBHOOK_BASIC_USER?.trim();
  if (!user) issues.push('NYMCARD_WEBHOOK_BASIC_USER is required and has no default');
  else if (user.includes(':')) issues.push('NYMCARD_WEBHOOK_BASIC_USER must not contain ":"');
  const password = secretIssue(
    'NYMCARD_WEBHOOK_BASIC_PASSWORD',
    cfg.NYMCARD_WEBHOOK_BASIC_PASSWORD,
    MIN_BASIC_PASSWORD_LENGTH,
  );
  if (password) issues.push(password);

  const hasName = Boolean(cfg.NYMCARD_WEBHOOK_HEADER_NAME?.trim());
  const hasValue = Boolean(cfg.NYMCARD_WEBHOOK_HEADER_VALUE?.trim());
  if (hasName !== hasValue) {
    issues.push('NYMCARD_WEBHOOK_HEADER_NAME and NYMCARD_WEBHOOK_HEADER_VALUE must be set together');
  } else if (hasValue) {
    const header = secretIssue(
      'NYMCARD_WEBHOOK_HEADER_VALUE',
      cfg.NYMCARD_WEBHOOK_HEADER_VALUE,
      MIN_PROVIDER_SECRET_LENGTH,
    );
    if (header) issues.push(header);
  }
  return issues;
}

// ───────────────────────────────────────────────────────────────────
// Production startup gate
// ───────────────────────────────────────────────────────────────────

const NON_LIVE_HOST = /sandbox|staging|\btest\b|mock|localhost|127\.0\.0\.1|0\.0\.0\.0|example\.(com|org|net)/i;
const PLACEHOLDER_VALUE = /x{4,}|your[-_ ]|_here\b|change[-_ ]?me|placeholder|example|dummy|sample|replace/i;

function liveCredentialIssue(variable: string, value: string | undefined): string | null {
  if (!value?.trim()) return `${variable} is required in production (without it the integration runs as a stub)`;
  if (PLACEHOLDER_VALUE.test(value)) return `${variable} looks like a placeholder`;
  return null;
}

function liveUrlIssue(variable: string, value: string | undefined): string | null {
  if (!value?.trim()) return `${variable} is required in production`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${variable} must be a valid URL`;
  }
  if (url.protocol !== 'https:') return `${variable} must use https in production`;
  if (NON_LIVE_HOST.test(value)) return `${variable} points at a sandbox or test host`;
  return null;
}

/**
 * Every reason production must refuse to start. Covers each integration
 * that can move or affect real money — not only webhook handlers.
 */
export function productionIntegrationIssues(cfg: IntegrationConfig): string[] {
  const issues: Array<string | null> = [
    // NymCard: card issuing, PAN reveal, card authorisation and settlement.
    liveCredentialIssue('NYMCARD_API_KEY', cfg.NYMCARD_API_KEY),
    liveUrlIssue('NYMCARD_API_BASE', cfg.NYMCARD_API_BASE),
    ...webhookCredentialIssues('nymcard', cfg),
    // MoneyHash: remittance FX and transfers; its webhook refunds wallets.
    liveCredentialIssue('MONEYHASH_API_KEY', cfg.MONEYHASH_API_KEY),
    liveUrlIssue('MONEYHASH_API_BASE', cfg.MONEYHASH_API_BASE),
    ...webhookCredentialIssues('moneyhash', cfg),
    // FlexxPay: EWA partner; its webhook moves loan state.
    liveCredentialIssue('FLEXXPAY_API_KEY', cfg.FLEXXPAY_API_KEY),
    liveUrlIssue('FLEXXPAY_API_BASE', cfg.FLEXXPAY_API_BASE),
    ...webhookCredentialIssues('flexxpay', cfg),
    // Biller rail: its webhook settles or refunds bills (adapter checked at boot).
    ...webhookCredentialIssues('biller', cfg),
    // MOHRE: the stub reports every worker registered, feeding payroll
    // intents and therefore EWA limits.
    liveUrlIssue('MOHRE_API_BASE', cfg.MOHRE_API_BASE),
    liveCredentialIssue('MOHRE_API_KEY', cfg.MOHRE_API_KEY),
    // Twilio: the stub logs step-up OTPs that authorise advances and remittances.
    liveCredentialIssue('TWILIO_ACCOUNT_SID', cfg.TWILIO_ACCOUNT_SID),
    liveCredentialIssue('TWILIO_AUTH_TOKEN', cfg.TWILIO_AUTH_TOKEN),
    liveCredentialIssue('TWILIO_PHONE_NUMBER', cfg.TWILIO_PHONE_NUMBER),
  ];
  return issues.filter((issue): issue is string => issue !== null);
}

/** Runtime-bound adapters that must not be stubs in production. */
export function productionAdapterIssues(state: { billerAdapterIsStub: boolean }): string[] {
  return state.billerAdapterIsStub
    ? ['the bill-payment adapter is the built-in stub (no real biller rail is bound)']
    : [];
}
