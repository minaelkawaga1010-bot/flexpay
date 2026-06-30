"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Copy,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * P2PTransferModal — screen-centered, accessible peer-to-peer payment
 * flow. Self-contained: owns its form state, validation, the POST to
 * /api/wallet/transfer, and the success surface that streams the
 * server-issued universalReceiptHash.
 *
 * Features:
 *   • Reactive phone masking — digits are formatted to +971 5X XXX XXXX
 *     as the user types; the raw E.164 value is what we submit.
 *   • Real-time balance math — available − amount = projected remaining,
 *     recomputed on every keystroke, with an over-balance guard.
 *   • Animated inline errors — field + form errors fade/slide via
 *     framer-motion AnimatePresence, announced with role="alert".
 *   • Streamed success receipt — the universalReceiptHash is revealed
 *     character-by-character so the verifiable id visibly "streams" in.
 */

export interface P2PTransferModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Spendable balance in the selected currency. */
  availableBalance: number;
  currency?: string;
  /** Called once a transfer settles successfully (e.g. to refetch). */
  onSuccess?: (receiptHash: string) => void;
}

type Phase = "form" | "submitting" | "success";

interface TransferResponse {
  message: string;
  universalReceiptHash: string;
  transfer: { id: string; reference?: string };
}

const CURRENCY = (c?: string) => c ?? "AED";

export function P2PTransferModal({
  open,
  onOpenChange,
  availableBalance,
  currency,
  onSuccess,
}: P2PTransferModalProps) {
  const [phase, setPhase] = useState<Phase>("form");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ phone?: string; amount?: string }>({});
  const [receiptHash, setReceiptHash] = useState("");
  const [streamedHash, setStreamedHash] = useState("");
  const [copied, setCopied] = useState(false);

  // Reset everything whenever the modal is (re)opened.
  useEffect(() => {
    if (open) {
      setPhase("form");
      setPhoneDigits("");
      setAmountInput("");
      setNote("");
      setFormError(null);
      setFieldErrors({});
      setReceiptHash("");
      setStreamedHash("");
      setCopied(false);
    }
  }, [open]);

  // Stream the receipt hash in once it lands.
  const streamTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (phase !== "success" || !receiptHash) return;
    let i = 0;
    streamTimer.current = setInterval(() => {
      i += 2;
      setStreamedHash(receiptHash.slice(0, i));
      if (i >= receiptHash.length && streamTimer.current) {
        clearInterval(streamTimer.current);
        streamTimer.current = null;
      }
    }, 16);
    return () => {
      if (streamTimer.current) clearInterval(streamTimer.current);
    };
  }, [phase, receiptHash]);

  const amount = useMemo(() => {
    const n = Number(amountInput.replace(/,/g, ""));
    return Number.isFinite(n) ? n : NaN;
  }, [amountInput]);

  const projectedRemaining = useMemo(() => {
    if (!Number.isFinite(amount) || amount <= 0) return availableBalance;
    return availableBalance - amount;
  }, [amount, availableBalance]);

  const overBalance = Number.isFinite(amount) && amount > availableBalance;

  const canSubmit =
    phoneDigits.replace(/\D/g, "").length >= 9 &&
    Number.isFinite(amount) &&
    amount > 0 &&
    !overBalance &&
    phase === "form";

  function validate(): boolean {
    const errs: { phone?: string; amount?: string } = {};
    const digits = phoneDigits.replace(/\D/g, "");
    if (digits.length < 9) errs.phone = "Enter a valid UAE mobile number.";
    if (!Number.isFinite(amount) || amount <= 0) errs.amount = "Enter an amount greater than zero.";
    else if (overBalance) errs.amount = "Amount exceeds your available balance.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit() {
    setFormError(null);
    if (!validate()) return;
    setPhase("submitting");
    try {
      const res = await fetch("/api/wallet/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiverPhone: toE164(phoneDigits),
          amount,
          currency: CURRENCY(currency),
          note: note || undefined,
        }),
      });
      const data = (await res.json()) as TransferResponse & { error?: string };
      if (!res.ok) {
        setFormError(data.error ?? "Transfer failed. Please try again.");
        setPhase("form");
        return;
      }
      setReceiptHash(data.universalReceiptHash);
      setPhase("success");
      onSuccess?.(data.universalReceiptHash);
    } catch {
      setFormError("Network error. Check your connection and try again.");
      setPhase("form");
    }
  }

  function copyHash() {
    if (!receiptHash) return;
    void navigator.clipboard?.writeText(receiptHash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <ArrowRight className="size-4" />
            </span>
            Send money
          </DialogTitle>
          <DialogDescription>
            Instant peer-to-peer transfer in {CURRENCY(currency)}. No fee.
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {phase === "success" ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="flex flex-col items-center gap-4 py-4 text-center"
              role="status"
              aria-live="polite"
            >
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 18 }}
                className="flex size-16 items-center justify-center rounded-full bg-emerald-500/15"
              >
                <CheckCircle2 className="size-9 text-emerald-500" />
              </motion.span>
              <div>
                <p className="text-lg font-semibold tracking-tight">Transfer complete</p>
                <p className="text-sm text-muted-foreground">
                  {fmt(amount)} {CURRENCY(currency)} sent to {maskPhoneDisplay(phoneDigits)}
                </p>
              </div>

              <div className="w-full rounded-lg border border-border bg-muted/40 p-3 text-left">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ShieldCheck className="size-3.5 text-emerald-500" />
                  Universal receipt hash
                </div>
                <div className="flex items-center gap-2">
                  <code className="block flex-1 break-all font-mono text-[11px] leading-relaxed text-foreground/90">
                    {streamedHash}
                    {streamedHash.length < receiptHash.length && (
                      <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-emerald-500 align-middle" />
                    )}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={copyHash}
                    aria-label="Copy receipt hash"
                    className="size-7 shrink-0"
                  >
                    {copied ? (
                      <CheckCircle2 className="size-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </Button>
                </div>
              </div>

              <Button className="w-full" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-4"
            >
              {/* Recipient phone */}
              <div className="grid gap-1.5">
                <Label htmlFor="p2p-phone">Recipient mobile</Label>
                <Input
                  id="p2p-phone"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+971 50 123 4567"
                  value={maskPhoneDisplay(phoneDigits)}
                  onChange={(e) => {
                    setPhoneDigits(e.target.value.replace(/\D/g, "").slice(0, 12));
                    if (fieldErrors.phone) setFieldErrors((s) => ({ ...s, phone: undefined }));
                  }}
                  aria-invalid={!!fieldErrors.phone}
                  aria-describedby={fieldErrors.phone ? "p2p-phone-err" : undefined}
                  className="font-mono tracking-wide transition-shadow focus-visible:shadow-[0_0_0_3px_rgba(16,185,129,0.18)]"
                />
                <InlineError id="p2p-phone-err" message={fieldErrors.phone} />
              </div>

              {/* Amount */}
              <div className="grid gap-1.5">
                <Label htmlFor="p2p-amount">Amount ({CURRENCY(currency)})</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    {CURRENCY(currency)}
                  </span>
                  <Input
                    id="p2p-amount"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amountInput}
                    onChange={(e) => {
                      setAmountInput(e.target.value.replace(/[^0-9.]/g, ""));
                      if (fieldErrors.amount) setFieldErrors((s) => ({ ...s, amount: undefined }));
                    }}
                    aria-invalid={!!fieldErrors.amount || overBalance}
                    aria-describedby={fieldErrors.amount ? "p2p-amount-err" : "p2p-balance"}
                    className="pl-12 font-mono tabular-nums transition-shadow focus-visible:shadow-[0_0_0_3px_rgba(16,185,129,0.18)]"
                  />
                </div>
                <InlineError id="p2p-amount-err" message={fieldErrors.amount} />
                {/* Real-time balance math */}
                <div
                  id="p2p-balance"
                  className="flex items-center justify-between text-xs text-muted-foreground"
                  aria-live="polite"
                >
                  <span>Available: {fmt(availableBalance)}</span>
                  <span
                    className={
                      overBalance
                        ? "font-medium text-red-500"
                        : "font-medium text-emerald-600 dark:text-emerald-400"
                    }
                  >
                    Remaining: {fmt(projectedRemaining)}
                  </span>
                </div>
              </div>

              {/* Note */}
              <div className="grid gap-1.5">
                <Label htmlFor="p2p-note">Note (optional)</Label>
                <Input
                  id="p2p-note"
                  placeholder="What's it for?"
                  value={note}
                  maxLength={120}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              {/* Form-level error */}
              <AnimatePresence>
                {formError && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    role="alert"
                    className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
                  >
                    <AlertCircle className="size-4 shrink-0" />
                    {formError}
                  </motion.div>
                )}
              </AnimatePresence>

              <Button
                className="w-full transition-transform active:scale-[0.98]"
                disabled={!canSubmit}
                onClick={handleSubmit}
              >
                {phase === "submitting" ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    Send {Number.isFinite(amount) && amount > 0 ? fmt(amount) : ""}
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

// ── Inline animated field error ─────────────────────────────────────

function InlineError({ id, message }: { id: string; message?: string }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.p
          id={id}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          role="alert"
          className="flex items-center gap-1 text-xs text-red-500"
        >
          <AlertCircle className="size-3" />
          {message}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Format AED-style amount with thousands + 2 dp. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Mask raw digits into a readable UAE format as the user types.
 * Input: "971501234567" → "+971 50 123 4567". Tolerant of partial
 * input so the field updates live without fighting the caret.
 */
function maskPhoneDisplay(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (!d) return "";
  let rest = d;
  let cc = "";
  if (rest.startsWith("971")) {
    cc = "+971 ";
    rest = rest.slice(3);
  } else if (rest.startsWith("0")) {
    rest = rest.slice(1);
    cc = "+971 ";
  } else {
    cc = "+971 ";
  }
  const p1 = rest.slice(0, 2);
  const p2 = rest.slice(2, 5);
  const p3 = rest.slice(5, 9);
  return [cc + p1, p2, p3].filter(Boolean).join(" ").trim();
}

/** Normalise typed digits to an E.164 UAE number for the API. */
function toE164(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.startsWith("971")) return `+${d}`;
  if (d.startsWith("0")) return `+971${d.slice(1)}`;
  return `+971${d}`;
}
