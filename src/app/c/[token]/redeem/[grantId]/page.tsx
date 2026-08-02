import QRCode from "qrcode";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { RewardGrant } from "@/lib/booth/types";
import { resolveMagicMember } from "../../data";
import { RewardDetail } from "../../reward-detail";
import { pollGrant } from "./actions";
import { RedemptionState } from "./redemption-state";

export default async function RedeemPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; grantId: string }>;
  searchParams: Promise<{ reveal?: string }>;
}) {
  const { token, grantId } = await params;
  const { reveal } = await searchParams;
  const memberId = await resolveMagicMember(token);
  const admin = createSupabaseAdminClient();
  const { data } = memberId
    ? await admin.from("reward_grants").select("*, members!inner(name)").eq("id", grantId).eq("member_id", memberId).maybeSingle()
    : { data: null };
  if (!data) return <RedemptionState token={token} grantId={grantId} initial={{ state: "invalid", redeemedAt: null }} rewardText="">{null}</RedemptionState>;

  const grant = data as RewardGrant & { members: { name: string } };
  const initial = await pollGrant(token, grantId);
  const qr = await QRCode.toDataURL(`bl:r:${grant.one_use_token}`, { errorCorrectionLevel: "M", margin: 2, color: { dark: "#000000", light: "#FFFFFF" }, width: 440 });

  // QA-only reveal hook (see /j/[slug] and /c/[token] for the matching ?qa=
  // pattern). Never honored in production, and never for an unchosen
  // multi-option grant — that would let the QR bypass the choice picker.
  const unchosen = grant.reward_options !== null && grant.chosen_at === null;
  const initialRevealed = reveal === "1" && process.env.NODE_ENV !== "production" && !unchosen;

  return (
    <RedemptionState token={token} grantId={grantId} initial={initial} rewardText={grant.reward_text}>
      <main className="min-h-screen bg-ink px-6 py-10 text-cream">
        <div className="mx-auto max-w-md">
          <RewardDetail
            token={token}
            grantId={grantId}
            rewardText={grant.reward_text}
            rewardOptions={grant.reward_options}
            expiresAt={grant.expires_at}
            qrDataUrl={qr}
            dark
            initialRevealed={initialRevealed}
          />
          <p className="mt-8 text-center font-display text-2xl font-bold">{grant.members.name}</p>
          <a href={`/c/${token}`} className="mt-10 flex justify-center font-display font-bold underline">
            Back to my card
          </a>
        </div>
      </main>
    </RedemptionState>
  );
}
