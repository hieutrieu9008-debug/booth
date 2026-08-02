# Booth — SMS loyalty for restaurants

A multi-tenant web app that lets a restaurant build and own a direct SMS relationship with its diners. Diners join by scanning a QR code, their visits are counted by a staff phone scan, and the system texts them when they've earned a reward or have gone quiet. Every redemption is verified at the till, so comebacks are counted rather than estimated.

No native app on either side — everything is mobile web.

---

## ⚠️ Notice — read before deploying

**This software is provided as is, with no warranty of any kind, express or implied, and with no support.** It is a development-stage codebase handed over for further work. Whoever deploys it does so at their own risk and is solely responsible for its security, its regulatory compliance, and any data it handles.

**It is not production-ready as it stands.** A security audit run before handover found unresolved issues, listed below. They are documented rather than fixed, deliberately — closing them is the responsibility of whoever takes this forward.

### Known security issues — must be fixed before any real deployment

1. **Every Server Action under `/internal` is unauthenticated.** `src/app/internal/layout.tsx` gates page *rendering* only. In the App Router, Server Actions are POST endpoints addressable by id, so a layout check does not protect them, and no action calls `hasInternalSession()`. There is no middleware. These actions use the service-role Supabase client, which bypasses RLS. Affected: `createRestaurantAction`, `addStaffPinAction` (`src/app/internal/actions.ts`), `provisionNumber` and the other exports in `src/app/internal/[slug]/actions.ts`, `applySetup` (`src/app/internal/[slug]/generate/actions.ts`), and all three branding uploads. **Fix: call an internal-session guard as the first statement of every one, and derive the restaurant id server-side rather than trusting the caller.**

2. **The public join page returns a live member-card link for numbers that are already enrolled.** `src/app/j/[slug]/actions.ts:76` returns `cardUrl` to the browser on the repeat-join path, and `join-form.tsx:79` renders it. Submitting a known phone number yields that diner's magic link and name. **Fix: never return the card link to an unverified submitter — send it by SMS only.**

3. **Staff console actions are not scoped to the authenticated restaurant.** `src/app/s/[slug]/actions.ts` authenticates a staff session against one tenant, then acts on member, event, and grant ids supplied by the client without re-checking ownership — including `undoAction`, which voids any event by id. **Fix: re-verify `restaurant_id` on every lookup and pass it into `fn_redeem_grant` / `fn_record_visit`.**

4. **The 4-digit staff PIN has no rate limiting, lockout, or attempt logging** (`src/app/s/[slug]/actions.ts`). It is brute-forceable, and a valid PIN grants diner phone lookup.

5. **Smaller items:** auto-generated staff PINs use `Math.random()` rather than a CSPRNG (`src/app/dashboard/staff/actions.ts`); the `/internal` access code is compared with non-constant-time `!==` and is unthrottled (`src/app/internal/gate-actions.ts`); `npm run lint` fails because no ESLint config is present; and `npm audit` reports four high-severity advisories, all transitive through `next@16.2.10` and cleared by a patch bump.

6. **Delete `src/app/api/dev-login/route.ts` before deploying.** It hard-404s when `NODE_ENV=production` or `VERCEL` is set, but it is a credentialed backdoor and should not exist in a deployed tree.

### Compliance

This app sends marketing SMS and stores consent records. That is regulated — UK PECR and US TCPA among others — and the penalties fall on whoever sends the messages. The compliance floor described below is a starting point, not legal advice and not a compliance guarantee. Get your own legal review before sending a single message to a real customer.

---

## Stack

Next.js 16.2 (App Router, React 19) · TypeScript strict · Tailwind 4 · Supabase (Postgres + auth + RLS) · Vitest · deployed on Vercel.

SMS goes through a provider adapter, not a hard dependency. A simulated provider runs in development, so the whole product is exercisable end to end with no telecom account and no real messages sent.

## Getting started

Prerequisites: Node 20+, Docker Desktop **running**, and the Supabase CLI. The whole app works offline with no telecom account — SMS is simulated in development.

```bash
git clone https://github.com/hieutrieu9008-debug/booth.git
cd booth
npm install
npx supabase start
```

`npx supabase start` prints an API URL, an anon key, and a service_role key. Copy `.env.example` to `.env.local` and fill in:

- the three Supabase values it just printed
- `NEXT_PUBLIC_APP_URL=http://localhost:3000`
- `CRON_SECRET`, `STAFF_AUTH_SECRET`, `INTERNAL_ACCESS_CODE` — any values you like locally

Then apply the schema, create a local owner account, and start:

```bash
npx supabase db reset     # runs all migrations + supabase/seed.sql
node scripts/dev-owner.mjs
npm run dev
```

### Signing in

There is no owner signup flow — owners are invited by an operator, by design. Locally, use the one-tap dev route:

**http://localhost:3000/api/dev-login**

That signs you in as the seeded demo owner and sets the staff and operator session cookies at the same time, so all four sides of the product are reachable immediately:

| | |
|---|---|
| `/dashboard/overview` | owner |
| `/s/demo-kitchen` | staff scan screen |
| `/internal` | operator console |
| `/j/demo-kitchen` | the diner join page a QR code points at |

`/api/dev-login` hard-404s when `NODE_ENV=production` or when `VERCEL` is set, but delete it before any real deploy anyway.

For richer demo data — a restaurant with months of history — run `npm run seed:demo`. Other seed scripts are in `scripts/`.

## Route map

| Path | Who it's for |
|---|---|
| `/j/[slug]` | Diner join page — the QR code target |
| `/c/[token]` | Diner member card, reached by magic link in every text |
| `/v/[slug]` | Diner self check-in (optional per restaurant) |
| `/s/[slug]` | Staff scan screen, behind a PIN |
| `/dashboard` | Restaurant owner |
| `/internal` | Operator console — tenant creation, number provisioning, program generation |
| `/api/cron/*` | Scheduled jobs (see `vercel.json`) |

## Data model

Ten migrations in `supabase/migrations`, applied in filename order. The core tables are `restaurants`, `members`, `reward_programs`, `member_progress`, `events`, `reward_grants`, `campaigns`, `messages`, `staff_pins`, and `magic_tokens`.

Two things are worth knowing before you change anything here:

**A member's phone number is their identity.** There is no diner login and no password. A signed magic-link token in each text is what opens their card.

**Visits and redemptions are `events` with a `source`.** That indirection exists so a POS integration can later emit the same events without a migration. Don't collapse it.

Migrations are append-only. Never edit one that has been applied — any environment that already ran it will silently diverge.

## The compliance floor — do not make this configurable

Four rules are hard-coded and deliberately not exposed as per-restaurant settings:

1. **Explicit consent**, stored with a timestamp and the exact wording version shown at the time.
2. **STOP is honored instantly** and logged, along with CANCEL, END, and QUIT, with or without punctuation.
3. **HELP returns a real reply.**
4. **Quiet hours are enforced on marketing sends.** Transactional messages (welcome, redemption confirmation) are exempt and classified separately in code.

These exist because SMS marketing is regulated on both sides of the Atlantic — UK PECR and US TCPA — and the penalties land on the sender. A tenant-overridable version of any of these is a liability, not a feature. All outbound messages route through `src/lib/sms/dispatch.ts`; never call a provider SDK directly.

## Design system

`DESIGN.md` is the visual law and the component kit in `src/components/kit` implements it. The short version: coral / cream / ink, Bricolage Grotesque + Figtree, and a hard "punch" shadow as the only elevation. Banned outright — gradients, glassmorphism, glows, loading spinners (use skeletons), emoji as icons, and pure black or white.

The landing page is the exception: its copy and components are open, since they depend on positioning that isn't settled.

## Testing

```bash
npm run typecheck && npm run test
```

43 test files covering the reward engine, consent and opt-out handling, quiet hours, timezone behavior, the redemption flow, and cross-tenant isolation. `npm run build` before calling anything done.

The suite runs with file parallelism disabled on purpose — shared demo-tenant fixtures caused intermittent failures otherwise.

## Known gaps

Honest list of what is not finished:

- **No SMS provider is wired.** The adapter interface and UK provisioning path are built and tested against mocks, but no account, credentials, or purchased numbers exist. Twilio was the leading candidate; nothing is committed.
- **The QR scan has never been tested on a printed sign with a real phone camera.** Do this before anyone prints anything.
- **`src/app/api/dev-login/route.ts` is a development convenience with hardcoded credentials.** Delete it before any production deploy.
- **No billing.** There is no payment integration of any kind.
- **US support is partial.** The schema and formatting handle both GB and US, but `src/lib/sms/provisioning.ts` implements the UK path only, and the settings page does not yet expose country or timezone for editing.
- **Landing page copy** reflects a go-to-market that is no longer current. Treat it as placeholder.
- The AI program generator in `/internal` requires `OPENAI_API_KEY`; without it, a manual draft path is used instead.
