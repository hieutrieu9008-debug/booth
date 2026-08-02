import { notFound } from "next/navigation";
import Link from "next/link";
import { requireOwnerRestaurant } from "@/lib/owner";
import { Card, Section } from "@/components/kit";
import { getCadenceSignal, getMemberProfile } from "@/lib/booth/dashboard-data";
import { CustomOfferPanel, DeleteMemberPanel, ExportDataButton, ExtendGrantControl, MessagePanel } from "./member-actions";

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

const EVENT_TYPE_LABEL: Record<string, string> = { visit: "Visit", redemption: "Redemption" };
const EVENT_SOURCE_LABEL: Record<string, string> = {
  staff_scan: "staff scan",
  self_scan: "self check-in",
  lookup: "phone lookup",
  pos_later: "POS",
  system: "system",
};
const GRANT_STATE_LABEL: Record<string, string> = { earned: "In wallet", redeemed: "Redeemed", expired: "Expired", voided: "Voided" };

export default async function MemberProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwnerRestaurant();
  const { id } = await params;
  const profile = await getMemberProfile(owner.id, id);
  if (!profile) notFound();

  const cadence = await getCadenceSignal(owner.id);

  return (
    <Section bg="paper">
      <Link href="/dashboard/members" className="text-sm font-semibold text-coral-dark underline">
        ← Back to Members
      </Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold">{profile.member.name}</h1>
          <p className="mt-1 text-base text-muted">{profile.member.phone}</p>
        </div>
        <Card border className="!p-4 text-sm">
          <p>
            <span className="font-semibold">Consent:</span>{" "}
            {profile.member.consent === "opted_in" ? "Opted in" : "Opted out"} · {formatDate(profile.member.consentTs)}
          </p>
          <p className="mt-1">
            <span className="font-semibold">Joined:</span> {formatDate(profile.member.joinedAt)}
          </p>
          {profile.member.birthdayMonth && (
            <p className="mt-1">
              <span className="font-semibold">Birthday:</span> {profile.member.birthdayMonth}/{profile.member.birthdayDay}
            </p>
          )}
        </Card>
      </div>

      {profile.ladders.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-xl font-bold">Ladder progress</h2>
          <div className="mt-3 space-y-2">
            {profile.ladders.map((l) => (
              <Card key={l.programName} border className="!p-4">
                <p className="font-semibold">{l.programName}</p>
                <p className="mt-1 text-sm text-muted">{l.label}</p>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-display text-xl font-bold">Wallet</h2>
        {profile.wallet.length === 0 ? (
          <p className="mt-3 text-base text-muted">No reward grants yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {profile.wallet.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-line pb-2">
                <span>
                  <span className="font-semibold">{g.rewardText}</span>{" "}
                  <span className="text-sm text-muted">
                    · {GRANT_STATE_LABEL[g.state]} · earned {formatDate(g.earnedAt)}
                    {g.expiresAt ? ` · expires ${formatDate(g.expiresAt)}` : ""}
                  </span>
                </span>
                {g.state === "earned" && g.expiresAt && <ExtendGrantControl grantId={g.id} expiresAt={g.expiresAt} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-display text-xl font-bold">Visit history</h2>
        {profile.events.length === 0 ? (
          <p className="mt-3 text-base text-muted">No visits yet.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {profile.events.map((e) => (
              <li key={e.id} className="flex items-center justify-between border-b-2 border-line pb-1.5 text-sm">
                <span>
                  {EVENT_TYPE_LABEL[e.type] ?? e.type} <span className="text-muted">({EVENT_SOURCE_LABEL[e.source] ?? e.source})</span>
                  {e.voided && <span className="ml-1 text-coral-dark">· undone</span>}
                </span>
                <span className="text-muted">{formatDateTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-display text-xl font-bold">Message history</h2>
        {profile.messages.length === 0 ? (
          <p className="mt-3 text-base text-muted">No messages yet.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {profile.messages.map((m) => (
              <li key={m.id} className="border-b-2 border-line pb-1.5 text-sm">
                <p className="text-muted">
                  {m.direction === "outbound" ? "Sent" : "Received"} · {m.kind} · {m.status} · {formatDateTime(m.createdAt)}
                </p>
                <p className="mt-0.5">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-display text-xl font-bold">Actions</h2>
        <MessagePanel memberId={profile.member.id} memberName={profile.member.name} cadence={cadence} />
        <CustomOfferPanel memberId={profile.member.id} memberName={profile.member.name} cadence={cadence} />
      </section>

      <section className="mt-8">
        <h2 className="font-display text-xl font-bold">Their data</h2>
        <div className="mt-3">
          <ExportDataButton memberId={profile.member.id} />
        </div>
        <DeleteMemberPanel memberId={profile.member.id} memberName={profile.member.name} />
      </section>
    </Section>
  );
}
