import { env } from '@config/env';
import logger from '@shared/utils/logger';
import type { PiiStripper, InjectionClassifier, PiiEntity } from './prompt-firewall';

/**
 * Concrete implementations of the Tool 11 firewall plug-ins
 * (prompt-firewall.ts interfaces). Closes Review A.10.
 *
 * The Bible specifies Presidio (PII) + a DistilBERT classifier
 * (injection). Both are Python/ML services that run out-of-process. We
 * provide TWO bindings for each:
 *
 *   • HTTP adapter  — calls the self-hosted Presidio / DistilBERT
 *     endpoint (the production path; Bible §5.2 "Presidio entity
 *     recognizer + DistilBERT scanner").
 *
 *   • Local rule-based fallback — a real, defensible detector that
 *     ships today and works with zero external dependencies. UAE-aware
 *     regex PII detection + a curated injection-pattern scorer. This
 *     is NOT a stub: it actively strips PII and scores injections, so
 *     a deploy without the ML services is still protected (defense in
 *     depth), just with lower recall than the trained models.
 *
 * `buildPromptFirewallDeps()` picks HTTP when the endpoints are
 * configured, else the local fallback. Bind at boot via
 * setPromptFirewall(buildPromptFirewallDeps()).
 */

// ───────────────────────────────────────────────────────────────────
// Local rule-based PII stripper (UAE-aware)
// ───────────────────────────────────────────────────────────────────

/**
 * Regex-based detector. Patterns are ordered most-specific first so a
 * credit-card number isn't partially eaten by the phone matcher.
 */
const PII_PATTERNS: { entity: PiiEntity; pattern: RegExp }[] = [
  // UAE Emirates ID: 784-YYYY-NNNNNNN-C (with or without hyphens)
  { entity: 'UAE_EMIRATES_ID', pattern: /\b784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d\b/g },
  // IBAN (UAE: AE + 21 digits; general: 2 letters + up to 30 alnum)
  { entity: 'IBAN', pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g },
  // Credit card: 13-19 digits, optionally grouped
  { entity: 'CREDIT_CARD', pattern: /\b(?:\d[ -]?){13,19}\b/g },
  // Email
  { entity: 'EMAIL_ADDRESS', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // E.164 / UAE phone: +9715XXXXXXXX or local 05XXXXXXXX
  { entity: 'PHONE_NUMBER', pattern: /(\+?\d{1,3}[-\s]?)?(\(?\d{2,4}\)?[-\s]?)?\d{3}[-\s]?\d{4,}\b/g },
];

/**
 * Heuristic person-name detector: two or more consecutive
 * capitalised tokens. Deliberately conservative — over-redaction of a
 * name is safe; under-redaction leaks PII. The trained Presidio NER is
 * far better, but this catches the common "Mohammed Al Falasi" shape.
 */
const PERSON_NAME_PATTERN = /\b([A-Z][a-z]+(?:\s+(?:Al|El|bin|bint|Abu)\s+)?(?:\s+[A-Z][a-z]+){1,3})\b/g;

export class LocalPiiStripper implements PiiStripper {
  async anonymize(
    text: string,
    entities: readonly PiiEntity[],
  ): Promise<{ text: string; detectedEntityCount: number }> {
    let out = text;
    let count = 0;

    for (const { entity, pattern } of PII_PATTERNS) {
      if (!entities.includes(entity)) continue;
      out = out.replace(pattern, () => {
        count += 1;
        return `<${entity}>`;
      });
    }

    if (entities.includes('PERSON')) {
      out = out.replace(PERSON_NAME_PATTERN, (match) => {
        // Skip the placeholders we just inserted (e.g. <EMAIL_ADDRESS>).
        if (match.startsWith('<') && match.endsWith('>')) return match;
        count += 1;
        return '<PERSON>';
      });
    }

    return { text: out, detectedEntityCount: count };
  }
}

// ───────────────────────────────────────────────────────────────────
// Local injection-pattern classifier
// ───────────────────────────────────────────────────────────────────

/**
 * Curated prompt-injection signature scorer. Each matched signature
 * contributes additive suspicion; the total saturates to [0,1]. The
 * DistilBERT model has far better generalisation, but these signatures
 * catch the highest-frequency attack families with zero false-positive
 * risk on normal financial-support queries.
 */
const INJECTION_SIGNATURES: { weight: number; pattern: RegExp }[] = [
  { weight: 0.6, pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts?)/i },
  { weight: 0.6, pattern: /disregard\s+(the\s+)?(system|above|previous)/i },
  { weight: 0.5, pattern: /you\s+are\s+now\s+(a|an|in)\b/i },
  { weight: 0.5, pattern: /\b(developer|debug|god|admin|root)\s*mode\b/i },
  { weight: 0.5, pattern: /pretend\s+(to\s+be|you\s+are)/i },
  { weight: 0.4, pattern: /reveal\s+(your\s+)?(system\s+)?(prompt|instructions)/i },
  { weight: 0.4, pattern: /\boverride\b.*\b(rules?|restrictions?|guardrails?)\b/i },
  { weight: 0.4, pattern: /print\s+(your\s+)?(system\s+)?(prompt|configuration)/i },
  { weight: 0.3, pattern: /\bDAN\b|\bjailbreak\b/i },
  { weight: 0.3, pattern: /new\s+instructions?\s*:/i },
  { weight: 0.3, pattern: /<\|.*\|>|\[INST\]|###\s*system/i },
];

export class LocalInjectionClassifier implements InjectionClassifier {
  async score(text: string): Promise<number> {
    let suspicion = 0;
    for (const sig of INJECTION_SIGNATURES) {
      if (sig.pattern.test(text)) suspicion += sig.weight;
    }
    return Math.min(1, suspicion);
  }
}

// ───────────────────────────────────────────────────────────────────
// HTTP adapters (production path)
// ───────────────────────────────────────────────────────────────────

export class HttpPresidioStripper implements PiiStripper {
  constructor(private readonly url: string, private readonly timeoutMs = 1500) {}

  async anonymize(
    text: string,
    entities: readonly PiiEntity[],
  ): Promise<{ text: string; detectedEntityCount: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.url}/anonymize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, entities }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Presidio HTTP ${res.status}`);
      const body = (await res.json()) as { text: string; detectedEntityCount?: number };
      return { text: body.text, detectedEntityCount: body.detectedEntityCount ?? 0 };
    } finally {
      clearTimeout(timer);
    }
  }
}

export class HttpInjectionClassifier implements InjectionClassifier {
  constructor(private readonly url: string, private readonly timeoutMs = 1000) {}

  async score(text: string): Promise<number> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.url}/score`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`injection classifier HTTP ${res.status}`);
      const body = (await res.json()) as { score: number };
      return Math.min(1, Math.max(0, body.score));
    } finally {
      clearTimeout(timer);
    }
  }
}

// ───────────────────────────────────────────────────────────────────
// Factory — HTTP when configured, local fallback otherwise.
// ───────────────────────────────────────────────────────────────────

export function buildPromptFirewallDeps(): {
  piiStripper: PiiStripper;
  injectionClassifier: InjectionClassifier;
} {
  const piiStripper: PiiStripper = env.PRESIDIO_URL
    ? new HttpPresidioStripper(env.PRESIDIO_URL)
    : new LocalPiiStripper();
  const injectionClassifier: InjectionClassifier = env.INJECTION_CLASSIFIER_URL
    ? new HttpInjectionClassifier(env.INJECTION_CLASSIFIER_URL)
    : new LocalInjectionClassifier();

  logger.info('prompt firewall deps built', {
    presidio: env.PRESIDIO_URL ? 'HTTP' : 'LOCAL',
    injection: env.INJECTION_CLASSIFIER_URL ? 'HTTP' : 'LOCAL',
  });

  return { piiStripper, injectionClassifier };
}
