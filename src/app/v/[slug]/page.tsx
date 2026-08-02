import { Card } from "@/components/kit";
import { validateCheckInAction } from "./actions";
import { renderCheckInResult } from "./result-view";
import { ConfirmCheckIn } from "./confirm-check-in";

/**
 * Reached by scanning the venue counter QR (WS-B item 2) — the raw `bl:v:`
 * payload is staff-scanner-only; this URL is what phone cameras open.
 *
 * Codex #1: this GET render must never record a visit — a link-preview bot,
 * a prefetch, or a plain refresh would otherwise stamp one. It only
 * validates (token, tenant cookie, hours) and, if every guard passes, hands
 * off to ConfirmCheckIn — a client component whose tap drives a POST-backed
 * Server Action (confirmCheckInAction) that alone is allowed to mutate.
 */
export default async function CheckInPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { slug } = await params;
  const { t } = await searchParams;
  const token = t ?? "";
  const validation = await validateCheckInAction(slug, token);

  return (
    <main className="min-h-screen bg-paper px-6 py-16 text-ink">
      <Card border className="mx-auto max-w-md text-center">
        {validation.kind === "ready" ? <ConfirmCheckIn slug={slug} token={token} /> : renderCheckInResult(validation)}
      </Card>
    </main>
  );
}
