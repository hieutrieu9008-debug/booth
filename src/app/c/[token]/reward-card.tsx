"use client";
import { useRef, useState } from "react";
import { Button, Card } from "@/components/kit";
import { RewardDetail, type RewardOption } from "./reward-detail";

const formatDate = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));

export type ActiveGrant = { id: string; reward_text: string; reward_options: RewardOption[] | null; expires_at: string | null };

/** Tapping a reward opens an in-page dialog instead of navigating (SPEC-WS2 §Member card 2). Escape/backdrop-click/X close with no side effect. */
export function RewardCard({ token, grant, qrDataUrl }: { token: string; grant: ActiveGrant; qrDataUrl: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [rewardText, setRewardText] = useState(grant.reward_text);

  return (
    <>
      <Card shadow border>
        <p className="font-display text-2xl font-extrabold">{rewardText}</p>
        {grant.expires_at && <p className="mt-2 text-base text-muted">expires {formatDate(grant.expires_at)}</p>}
        <Button type="button" className="mt-6 w-full" onClick={() => dialogRef.current?.showModal()}>
          Redeem
        </Button>
      </Card>
      <dialog
        ref={dialogRef}
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
        className="m-auto w-[min(92vw,420px)] rounded-card border-2 border-ink bg-paper p-0 shadow-punch backdrop:bg-ink/50"
      >
        <div className="relative p-6">
          <button
            type="button"
            aria-label="Close"
            onClick={() => dialogRef.current?.close()}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border-2 border-ink bg-cream font-display text-lg font-bold"
          >
            ×
          </button>
          <div className="pr-10">
            <RewardDetail
              token={token}
              grantId={grant.id}
              rewardText={rewardText}
              rewardOptions={grant.reward_options}
              expiresAt={grant.expires_at}
              qrDataUrl={qrDataUrl}
              onChosen={setRewardText}
            />
          </div>
        </div>
      </dialog>
    </>
  );
}
