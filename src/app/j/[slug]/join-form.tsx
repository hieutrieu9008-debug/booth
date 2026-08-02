"use client";
import { useActionState, useState } from "react";
import { Button, Card, Checkbox, Field, PhoneInput, Section, Stamp } from "@/components/kit";
import { consentCopyFor } from "@/lib/booth/consent";
import { daysInMonth } from "@/lib/booth/format";
import { joinAction, type JoinState } from "./actions";

const initialJoinState: JoinState = { status: "idle" };
/** Masks all but the prefix's first digit and the last two digits — prefix-aware so +1 (2-char prefix) and +44 (3-char prefix) both mask sensibly. */
const maskPhone = (phone: string, phonePrefix: string) => `${phone.slice(0, phonePrefix.length + 1)} ••• ••${phone.slice(-2)}`;

export function JoinForm({
  slug,
  restaurantName,
  phonePrefix,
  country,
  endowment,
  rewardCopy,
  qaPreviewSuccess,
}: {
  slug: string;
  restaurantName: string;
  phonePrefix: string;
  country: string;
  endowment: { current: number; target: number } | null;
  rewardCopy: string | null;
  /** QA-only (never set outside dev): renders the success screen straight from mount so it's screenshot-able without a real submit. See /j/[slug]?qa=success. */
  qaPreviewSuccess?: JoinState["result"];
}) {
  const [claimed, setClaimed] = useState(!endowment);
  const [birthdayOpen, setBirthdayOpen] = useState(false);
  const [birthdayMonth, setBirthdayMonth] = useState<number | null>(null);
  const [consented, setConsented] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const startState: JoinState = qaPreviewSuccess ? { status: "success", result: qaPreviewSuccess } : initialJoinState;
  const [state, action, pending] = useActionState(joinAction.bind(null, slug), startState);

  if (state.status === "opted_out" && state.error) {
    return (
      <main className="min-h-screen bg-paper px-6 py-12 text-ink">
        <div className="mx-auto max-w-md">
          <Card shadow border className="text-center">
            <h1 className="font-display text-4xl font-extrabold">You&apos;re opted out</h1>
            <p className="mt-3 text-base text-muted">{state.error}</p>
          </Card>
        </div>
      </main>
    );
  }

  if (state.status === "success" && state.result) {
    return (
      <main className="min-h-screen bg-paper px-6 py-12 text-ink">
        <div className="mx-auto max-w-md">
          <Card shadow border className="text-center">
            {state.result.repeatJoin ? (
              <>
                <h1 className="font-display text-4xl font-extrabold">You&apos;re already in — we&apos;ve updated your details.</h1>
                <p className="mt-3 text-base text-muted">
                  Your Booth rewards card is unchanged. Every visit still counts toward your next reward, and offers land here first.
                </p>
              </>
            ) : (
              <>
                <h1 className="font-display text-4xl font-extrabold">You&apos;re in, {state.result.name}.</h1>
                <p className="mt-3 text-base text-muted">
                  This is your Booth rewards card. Every visit counts toward your next reward, and offers land here first.
                </p>
              </>
            )}
            {state.result.welcomeReward && (
              <Section bg="coral" className="-mx-6 mt-8 !w-auto rounded-card !py-0">
                <h2 className="font-display text-3xl font-extrabold">Your welcome perk</h2>
                <p className="mt-3 text-xl font-semibold">{state.result.welcomeReward}</p>
                <p className="mt-3 text-lg">It&apos;s on your card. Show it next time you&apos;re in.</p>
              </Section>
            )}
            <Button href={state.result.cardUrl} className="mt-8 w-full">
              See my card
            </Button>
            <p className="mt-5 text-base text-muted">We&apos;ve texted your card link to {maskPhone(state.result.phone, phonePrefix)}, that&apos;s where it lives from now on.</p>
            <ul className="mt-6 space-y-1.5 text-left text-sm text-muted">
              <li>· Your progress and active rewards, always on your card</li>
              <li>· New offers text you directly, first</li>
              <li>· Reply STOP any time to opt out</li>
            </ul>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <>
      {endowment && !claimed && (
        <Card shadow border className="relative mt-10">
          <Stamp className="absolute -right-2 -top-5">head start</Stamp>
          <p className="pr-16 font-display text-2xl font-extrabold">
            Your head start: {endowment.current} of {endowment.target} visits already stamped
          </p>
          {rewardCopy && <p className="mt-2 text-base text-muted">toward {rewardCopy}</p>}
          <Button className="mt-6 w-full" onClick={() => setClaimed(true)}>
            Claim my head start
          </Button>
        </Card>
      )}
      {claimed && (
        <form action={action} className="mt-10 space-y-6">
          <div style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px", overflow: "hidden" }} aria-hidden="true">
            <label htmlFor="website">Website</label>
            <input type="text" id="website" name="website" tabIndex={-1} autoComplete="off" />
          </div>
          <Field
            id="name"
            name="name"
            label="First name"
            required
            autoComplete="given-name"
            placeholder="John"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={state.fieldErrors?.name}
          />
          <PhoneInput id="phone" name="phone" label="Mobile number" prefix={phonePrefix} required value={phone} onChange={setPhone} error={state.fieldErrors?.phone} />
          {!birthdayOpen ? (
            <Button type="button" variant="ghost" className="w-full" onClick={() => setBirthdayOpen(true)}>
              Add my birthday (free treat)
            </Button>
          ) : (
            <fieldset>
              <legend className="text-sm font-semibold">Birthday (optional)</legend>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <select
                  name="birthdayMonth"
                  aria-label="Birthday month"
                  className="min-h-12 rounded-button border-2 border-line bg-cream px-3 text-base"
                  onChange={(e) => setBirthdayMonth(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Month</option>
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </select>
                <select name="birthdayDay" aria-label="Birthday day" className="min-h-12 rounded-button border-2 border-line bg-cream px-3 text-base">
                  <option value="">Day</option>
                  {/* Constrained to the selected month's real length (Feb=29 allowed — no year is stored) so the picker can't offer an impossible date. */}
                  {Array.from({ length: daysInMonth(birthdayMonth ?? 1) }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </div>
              {state.fieldErrors?.birthday && (
                <p role="alert" className="mt-2 text-sm font-semibold text-coral-dark">
                  {state.fieldErrors.birthday}
                </p>
              )}
            </fieldset>
          )}
          <Checkbox
            id="consent"
            name="consent"
            required
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
            label={consentCopyFor(country, restaurantName)}
          />
          {state.fieldErrors?.consent && (
            <p role="alert" className="text-sm font-semibold text-coral-dark">
              {state.fieldErrors.consent}
            </p>
          )}
          {state.error && (
            <Card bg="paper" border role="alert">
              <p className="font-semibold">{state.error}</p>
            </Card>
          )}
          <div className="sticky bottom-0 -mx-6 bg-paper px-6 pb-6 pt-3">
            <Button type="submit" disabled={!consented || pending} className="w-full">
              {pending ? "Continuing…" : "Continue"}
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
