# Booth — Visual Identity v4: "FILL TUESDAY"

> **STATUS: the visual system is locked; the landing page is not.** The SYSTEM below (palette, type, shadows, shapes, waves, motion) applies to every page and surface. The landing page's specific components and copy are open — rebuild them per the "Landing hero spec" below once the product's positioning is settled.

## Messaging rules (override anything conflicting below)
- The headline says WHAT WE DO, plainly: bring customers back through SMS. Working headline register: "Bring back customers through SMS" / "We bring your customers back. By text." NEVER a sub-niche line as the headline ("Fill Tuesday" is demoted — usable deeper in the page at most).
- The first screen must instantly convey: uplift in revenue by reducing churn; one-time customers → regulars, regulars → better regulars; via SMS; plug-and-play simple.
- Landing copy refinement deferred until the app's real shape exists (post-M9); don't over-polish before then.

## Landing hero spec
Full-bleed SOLID single-color hero panel (our coral #F26649), faint oversized text-texture watermark in the panel background. LEFT: large flat product artifact where the reference has the book — for Booth, an iOS-style phone (realistic iMessage framing) showing a Booth deal text from a restaurant ("Booth Loyalty: here's a deal - tap to redeem" energy) — this phone artifact is APPROVED here (supersedes the marketing no-phone rule for the hero only; content must depict a plausible SMS deal, nothing invented beyond it). RIGHT: small eyebrow line → bold 2-line headline (see messaging rules) → short sub → primary CTA button (Book a 15-minute call; NO input fields). Nav above on white/paper.

This system replaces an earlier "Bold Flat & Punchy" pass, kept further down as heritage where still true. Bricolage Grotesque + Figtree + the hard punch shadow are the signature combination — treat them as the identity, not as defaults to swap out.

Tokens use canonical names (no version prefix).

## Palette (from landing-v1.html — flat solids only)
| Token | Hex | Use |
|---|---|---|
| `--ink` | `#20231F` | text, borders, dark blocks, shadows |
| `--coral` | `#F26649` | PRIMARY — hero panels, brand moments, accents |
| `--coral-dark` | `#A92E1D` | coral's text-safe partner / hover |
| `--cream` | `#FFF4DF` | light type on coral, warm surfaces |
| `--paper` | `#F8EEE0` | page background |
| `--peach` | `#FFD9C5` | soft fills, highlights |
| `--butter` | `#F7D777` | badges/stamps, small pops |
| `--muted` | `#625A52` | secondary text |
| `--line` | `#8F8173` | hairlines/borders |
AA rules: ink on paper/cream = body; cream/white on coral for LARGE text only; coral-dark for small text on light. Never pure #000/#fff.

## Typography
- Display: **Bricolage Grotesque** 600/700/800 (Google Fonts, opsz axis) — giant, rounded-confident. Hero = enormous two-word statements ("Fill Tuesday.") with two-tone color (ink + cream/coral split).
- Body/UI: **Figtree** 400/500/600/700, ≥16px, line-height 1.6.
- Max 2 families, referenced by name. Load via next/font/google; verify fonts actually render (not system fallback) with a screenshot before claiming done.

## Shape, depth, layout language
- **Punch shadow** (the signature): `7px 8px 0 var(--ink)` on floating cards/CTAs, shrinking on press. One elevation strategy — never mix with soft shadows.
- Radius: cards 16-24px, buttons = pills or 12px. Chips/badges rounded-full.
- **Waves, not borders:** sections flow via curved/organic transitions and overlapping elements. No hard stacked blocks.
- Floating flat cards (plain type inside — see mockup rule below), playful rotated stamps/badges (butter circle, ink text) as annotation devices.
- Photos: real photography only (repo `mockups/img/` + `img/gen/`), framed with radius + optional ink border, NEVER full-bleed behind text. Playful stamp overlays allowed.

## Copy voice (locked doctrine — as important as the pixels)
- SELL THE OUTCOME, NEVER THE MECHANICS. No how-it-works step diagrams on marketing surfaces. Pain first ("Your regulars are disappearing. Quietly."), then the turn ("We give them a reason to come back"), then proof.
- Numbers big and confident, always internally consistent and labeled: "~100 customers back a month · that's 3 a day · at a £15 average ticket, about £1,500 of comebacks · Example month". NEVER invent unlabeled figures.
- Talks like a person. No em-dashes, no "seamless/delve/elevate" diction, no eyebrow-label clutter.

## Marketing-surface mockup rule
NO fake product UI (phone frames, dashboard charts, message-thread UIs) on the landing while the real product looks different — plain outcome cards with type only. Revisit once real screenshots exist.

## Hard bans (unchanged + extended)
No gradients (esp. purple), no glassmorphism/backdrop-blur, no glows/auras, no grain, no full-bleed photo behind text, no scroll-hidden content (opacity-0 + IntersectionObserver), no emoji as icons, no spinners (skeletons only), no Inter, no marquee, no hero input fields (fake doors), no serif defaults.

## App surfaces (build per PRD; same tokens, calmer application)
- Diner pages (design priority #1): paper/cream surfaces, coral reserved for the reward moment and primary action; **dim-room test**: judge at 40% brightness at arm's length; QR flat, max contrast, ≥3cm; endowed progress visible ("4 of 6"); every data screen ships skeleton/empty/error/success.
- Staff screen: MASSIVE type, one unambiguous state per scan, 44px+ targets in thumb zone, instant press feedback, zero decoration.
- Owner dashboard: paper bg, white cards + hairlines, Bricolage stat numbers big, coral primary actions only, butter badges for "gone quiet".
- Motion: 150-300ms state-signaling only; count-up on money numbers; prefers-reduced-motion collapses everything.

## NEVER list (enforcement artifact — check before every ship)
gradients · glass · glow · grain · photo-behind-text · scroll-reveal hiding · emoji icons · spinners · Inter · purple anything · fake UI on marketing pages · unlabeled invented numbers · mechanics-explaining marketing copy · hero input fields · mixed elevation strategies · fonts declared but not loaded
