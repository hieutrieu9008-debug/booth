"use client";
import { useState, useTransition } from "react";
import { Button, Card } from "@/components/kit";
import { chooseRewardAction } from "./actions";

const formatDate = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));

export type RewardOption = { reward: string; ring_up_note?: string | null };

/**
 * WS-E item 4: a single-option grant needs no choice, so its QR should be
 * visible the instant this opens rather than gated behind an extra "Show my
 * code" tap. A multi-option grant still requires a pick first (or the
 * initialRevealed QA override) regardless of this default.
 */
export function initialRevealState(rewardOptions: RewardOption[] | null, initialRevealed: boolean): boolean {
  const hasChoice = !!rewardOptions && rewardOptions.length > 1;
  return initialRevealed || !hasChoice;
}

/**
 * Shared reward-redemption content: choice picker (re-choosable while
 * earned) -> full terms -> reveal the one-use QR. Used both inside the
 * card-page popup dialog and on the /redeem/[grantId] deep-link fallback —
 * same component, different chrome around it (SPEC-WS2 §Member card 2).
 */
export function RewardDetail({
  token,
  grantId,
  rewardText,
  rewardOptions,
  expiresAt,
  qrDataUrl,
  onChosen,
  dark = false,
  initialRevealed = false,
}: {
  token: string;
  grantId: string;
  rewardText: string;
  rewardOptions: RewardOption[] | null;
  expiresAt: string | null;
  qrDataUrl: string;
  onChosen?: (rewardText: string) => void;
  dark?: boolean;
  /** QA-only: preset the reveal state from a page searchParam so the QR-revealed state is screenshot-able without a click (see /redeem/[grantId]?reveal=1). Never used by the real diner flow. */
  initialRevealed?: boolean;
}) {
  const currentIndex = rewardOptions?.findIndex((o) => o.reward === rewardText) ?? -1;
  const [selected, setSelected] = useState(currentIndex >= 0 ? currentIndex : null);
  const [displayText, setDisplayText] = useState(rewardText);
  const [revealed, setRevealed] = useState(initialRevealState(rewardOptions, initialRevealed));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const hasChoice = !!rewardOptions && rewardOptions.length > 1;
  const unchosen = hasChoice && selected === null;
  // Belt-and-braces: the QR can never render while unchosen, no matter what
  // set revealed true (a stale prop, a future bug) — the choice picker is
  // the only path a diner can take from here.
  const showQr = revealed && !unchosen;

  function choose(index: number) {
    setError(null);
    startTransition(async () => {
      const result = await chooseRewardAction(token, grantId, index);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSelected(index);
      setDisplayText(result.rewardText);
      onChosen?.(result.rewardText);
    });
  }

  const bodyTone = dark ? "text-cream" : "text-ink";
  const mutedTone = dark ? "text-cream/80" : "text-muted";

  return (
    <div className={bodyTone}>
      <p className="font-display text-3xl font-extrabold">{displayText}</p>

      {hasChoice && (
        <div className="mt-5">
          <p className={`text-sm font-semibold ${mutedTone}`}>{selected === null ? "Choose your reward" : "Your pick, tap to change"}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {rewardOptions!.map((option, index) => (
              <button
                key={option.reward}
                type="button"
                disabled={pending}
                onClick={() => choose(index)}
                aria-pressed={selected === index}
                className={`min-h-11 rounded-button border-2 border-ink px-4 text-base font-semibold transition-transform active:translate-y-[1px] disabled:opacity-50 ${
                  selected === index ? "bg-coral text-cream" : dark ? "bg-cream text-ink" : "bg-cream text-ink"
                }`}
              >
                {option.reward}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="mt-2 text-sm font-semibold text-coral-dark">
              {error}
            </p>
          )}
        </div>
      )}

      <div className={`mt-6 space-y-1 text-sm ${mutedTone}`}>
        <p>Staff scans this code to redeem it. One use only.</p>
        {expiresAt && <p>Expires {formatDate(expiresAt)}.</p>}
      </div>

      {!showQr ? (
        <Button className="mt-6 w-full" disabled={unchosen} onClick={() => setRevealed(true)}>
          {unchosen ? "Choose your reward first" : "Show my code"}
        </Button>
      ) : (
        <Card shadow border className="mx-auto mt-6 w-fit !p-3">
          <img src={qrDataUrl} width={220} height={220} alt="One-use reward QR code" className="block h-[220px] w-[220px]" />
        </Card>
      )}
    </div>
  );
}
