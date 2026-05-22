import logger from '@shared/utils/logger';
import { z } from 'zod';

/**
 * Tool 11 — Prompt-Injection Firewall.
 *
 * Closes Bible §5.3.6. EVERY LLM call (Claude / GPT-4o / Llama via
 * Bedrock or self-hosted) MUST pass through this guard.
 *
 * Two layers:
 *
 *   1. PII strip (Presidio) — strips PERSON / UAE_EMIRATES_ID / IBAN
 *      / CREDIT_CARD / PHONE_NUMBER / EMAIL_ADDRESS from the user
 *      input. No raw PII ever reaches an external LLM (Bible §5.2
 *      "No PII ever reaches external LLM APIs").
 *
 *   2. Injection scan (DistilBERT classifier) — refuses inputs whose
 *      injection-likelihood score exceeds INJECTION_REJECT_THRESHOLD
 *      (Bible: 0.85).
 *
 * The implementations of Presidio and the DistilBERT classifier live
 * out-of-process (Presidio self-hosted Python, DistilBERT on a small
 * inference endpoint). They are abstracted behind two interfaces so
 * the call sites in `src/` only ever reach `guardedLLMCall`.
 *
 * Failure modes:
 *   • PII strip down → fail-closed (raise FirewallError). Better to
 *     surface a user-facing "service unavailable" than leak PII.
 *   • Injection scanner down → fail-closed (same reasoning).
 *   • Both pass → invoke the LLM via the injected `llmInvoke` fn.
 *
 * The guard wraps the LLM call; the call site does not see the raw
 * model SDK.
 */

export const INJECTION_REJECT_THRESHOLD = 0.85;

export const PII_ENTITIES = [
  'PERSON',
  'UAE_EMIRATES_ID',
  'IBAN',
  'CREDIT_CARD',
  'PHONE_NUMBER',
  'EMAIL_ADDRESS',
] as const;
export type PiiEntity = (typeof PII_ENTITIES)[number];

// ───────────────────────────────────────────────────────────────────
// Plug-in contracts
// ───────────────────────────────────────────────────────────────────

export interface PiiStripper {
  /**
   * Returns a redacted copy of `text` with the requested entities
   * replaced by entity-typed placeholders (e.g. `<PERSON>`).
   * Implementations: Presidio (presidio-analyzer + presidio-anonymizer
   * over HTTP).
   */
  anonymize(
    text: string,
    entities: readonly PiiEntity[],
  ): Promise<{ text: string; detectedEntityCount: number }>;
}

export interface InjectionClassifier {
  /**
   * Returns the per-text injection-likelihood score ∈ [0,1].
   * Implementations: DistilBERT fine-tuned on prompt-injection corpora,
   * hosted on a small inference endpoint.
   */
  score(text: string): Promise<number>;
}

export interface LlmInvoker {
  invoke(args: { systemPrompt: string; sanitizedUserInput: string }): Promise<string>;
}

// ───────────────────────────────────────────────────────────────────
// Errors
// ───────────────────────────────────────────────────────────────────

export type FirewallRejection =
  | 'PII_STRIPPER_UNAVAILABLE'
  | 'INJECTION_CLASSIFIER_UNAVAILABLE'
  | 'PROMPT_INJECTION_DETECTED'
  | 'OUTPUT_SCHEMA_INVALID';

export class FirewallError extends Error {
  constructor(
    public readonly reason: FirewallRejection,
    public readonly context: Record<string, unknown> = {},
  ) {
    super(`PromptFirewall: ${reason}`);
    this.name = 'FirewallError';
  }
}

// ───────────────────────────────────────────────────────────────────
// Defaults — fail-closed stubs
// ───────────────────────────────────────────────────────────────────

/**
 * Default stripper — refuses to run. Production binds via
 * `setPromptFirewall({ piiStripper, injectionClassifier })` at boot.
 * The fail-closed default ensures a misconfigured deploy cannot
 * accidentally bypass Tool 11.
 */
const DEFAULT_STRIPPER: PiiStripper = {
  async anonymize() {
    throw new FirewallError('PII_STRIPPER_UNAVAILABLE');
  },
};

const DEFAULT_CLASSIFIER: InjectionClassifier = {
  async score() {
    throw new FirewallError('INJECTION_CLASSIFIER_UNAVAILABLE');
  },
};

let stripper: PiiStripper = DEFAULT_STRIPPER;
let classifier: InjectionClassifier = DEFAULT_CLASSIFIER;

export function setPromptFirewall(deps: {
  piiStripper?: PiiStripper;
  injectionClassifier?: InjectionClassifier;
}): void {
  if (deps.piiStripper) stripper = deps.piiStripper;
  if (deps.injectionClassifier) classifier = deps.injectionClassifier;
  logger.info('Prompt firewall (Tool 11) bound', {
    stripper: stripper === DEFAULT_STRIPPER ? 'STUB' : 'CONFIGURED',
    classifier: classifier === DEFAULT_CLASSIFIER ? 'STUB' : 'CONFIGURED',
  });
}

// ───────────────────────────────────────────────────────────────────
// Main entrypoint — every LLM call goes through this.
// ───────────────────────────────────────────────────────────────────

export interface GuardedLLMCallArgs<TOut> {
  systemPrompt: string;
  userInput: string;
  /** Caller-provided LLM driver. Receives ONLY the sanitized input. */
  llm: LlmInvoker;
  /**
   * Zod schema to parse the LLM output against. Output validation
   * is part of the contract — an LLM that emits unexpected shapes is
   * a contract breach, not a recoverable condition.
   */
  outputSchema: z.ZodType<TOut>;
  /** Optional override of the injection-reject threshold for this call. */
  injectionRejectThreshold?: number;
  /** Optional caller-provided correlation id for audit traces. */
  correlationId?: string;
}

export async function guardedLLMCall<TOut>(args: GuardedLLMCallArgs<TOut>): Promise<TOut> {
  const threshold = args.injectionRejectThreshold ?? INJECTION_REJECT_THRESHOLD;

  // Layer 1: PII strip
  let stripped: { text: string; detectedEntityCount: number };
  try {
    stripped = await stripper.anonymize(args.userInput, PII_ENTITIES);
  } catch (err) {
    if (err instanceof FirewallError) throw err;
    throw new FirewallError('PII_STRIPPER_UNAVAILABLE', {
      cause: (err as Error).message,
    });
  }

  // Layer 2: injection classifier
  let injectionScore: number;
  try {
    injectionScore = await classifier.score(stripped.text);
  } catch (err) {
    if (err instanceof FirewallError) throw err;
    throw new FirewallError('INJECTION_CLASSIFIER_UNAVAILABLE', {
      cause: (err as Error).message,
    });
  }

  if (injectionScore > threshold) {
    logger.warn('Tool 11: prompt injection rejected', {
      correlationId: args.correlationId,
      injectionScore,
      threshold,
      detectedEntities: stripped.detectedEntityCount,
    });
    throw new FirewallError('PROMPT_INJECTION_DETECTED', {
      injectionScore,
      threshold,
    });
  }

  // Layer 3: invoke LLM with sanitized input only
  const raw = await args.llm.invoke({
    systemPrompt: args.systemPrompt,
    sanitizedUserInput: stripped.text,
  });

  // Layer 4: output schema validation
  let parsed: TOut;
  try {
    parsed = args.outputSchema.parse(JSON.parse(raw));
  } catch (err) {
    throw new FirewallError('OUTPUT_SCHEMA_INVALID', {
      cause: (err as Error).message,
      // Truncate the raw output in the error context so we don't
      // accidentally re-introduce PII that the LLM hallucinated back.
      rawSample: raw.slice(0, 200),
    });
  }
  return parsed;
}
