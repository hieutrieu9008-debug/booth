"use client";

import { useState, useTransition } from "react";
import { Button, Card } from "@/components/kit";
import type { MessageHistoryRow } from "./data";
import { retryStalledCampaignAction } from "./actions";

const formatDateTime = (v: string | null) =>
  v ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(v)) : "—";

function RetryButton({ campaignId }: { campaignId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function retry() {
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await retryStalledCampaignAction(campaignId);
        setMessage(res.ok ? `Retried — sent to ${res.sentCount} people.` : res.error);
      } catch {
        setMessage("Retry didn't go through — try again in a moment.");
      }
    });
  }

  return (
    <div className="mt-2">
      <Button className="!min-h-9 !px-3 !text-sm" disabled={pending} onClick={retry}>
        {pending ? "Retrying…" : "Retry now"}
      </Button>
      {message && <p className="mt-1 text-sm font-semibold text-ink">{message}</p>}
    </div>
  );
}

export function History({ messages }: { messages: MessageHistoryRow[] }) {
  if (messages.length === 0) {
    return <p className="mt-4 text-base text-muted">No messages sent yet.</p>;
  }
  return (
    <div className="mt-4 space-y-3">
      {messages.map((c) => (
        <Card key={c.id} border className="!p-4">
          <p className="text-sm font-semibold text-muted">
            {c.audience}
            {c.filtersSummary ? ` · ${c.filtersSummary}` : ""} · {c.stalled ? "stalled" : c.status}
            {c.status === "sent" ? ` · sent ${formatDateTime(c.sentAt)}` : ` · due ${formatDateTime(c.scheduledFor)}`}
          </p>
          <p className="mt-1 text-base">{c.body}</p>
          <p className="mt-2 text-sm font-semibold">
            {c.sentCount} sent · {c.redeemedCount} redeemed · {c.optOutCount} opt-outs
          </p>
          {c.stalled && (
            <>
              <p className="mt-2 text-sm font-semibold text-coral-dark">
                This message stalled partway through sending — it stopped before reaching everyone. It retries
                automatically within ~30 minutes, or retry it now below. Nobody already texted will be texted twice.
              </p>
              <RetryButton campaignId={c.id} />
            </>
          )}
        </Card>
      ))}
    </div>
  );
}
