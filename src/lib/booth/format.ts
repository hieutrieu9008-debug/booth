import { formatUkMobile, formatUsMobile } from "@/components/kit/phone-format";

/**
 * Dual-market shared formatters (SPEC-WSA A2). Nothing here hardcodes a
 * market — every call site resolves country/currency/phone_prefix from the
 * restaurant row.
 */

/** Prefixes where a trunk "0" is dropped before appending the E.164 prefix (UK/Ireland/Australia mobile convention). NOT +1 (NANP has no trunk-0). */
const TRUNK_ZERO_PREFIXES = ["+44", "+353", "+61"];

/**
 * Formats an amount for display using the currency's canonical locale
 * (GBP -> en-GB, USD -> en-US); any other currency falls back to the
 * Intl default locale for that currency code. `country` is accepted for
 * forward-compat (a future currency shared across countries, e.g. EUR)
 * but isn't needed to disambiguate GBP/USD.
 */
export function formatCurrency(amount: number, currency: string, country?: string): string {
  void country; // reserved for a future currency shared across countries (e.g. EUR); GBP/USD don't need it
  const locale = currency === "GBP" ? "en-GB" : currency === "USD" ? "en-US" : undefined;
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

/**
 * Formats a stored E.164 number for national display: UK grouping for +44
 * (reuses formatUkMobile), NANP grouping for +1, otherwise a generic grouped
 * fallback of the digits after the prefix.
 */
export function formatPhoneNational(e164: string, phonePrefix: string): string {
  if (!e164.startsWith(phonePrefix)) return e164;
  const rest = e164.slice(phonePrefix.length).replace(/\D/g, "");
  const prefixDigits = phonePrefix.replace(/\D/g, "");

  if (prefixDigits === "44") return formatUkMobile(`0${rest}`);
  if (prefixDigits === "1") {
    if (rest.length !== 10) return e164;
    return formatUsMobile(rest);
  }
  const grouped = rest.match(/.{1,3}/g)?.join(" ") ?? rest;
  return `${phonePrefix} ${grouped}`;
}

/**
 * Generalized join-flow phone normalizer: raw user input + the restaurant's
 * phone_prefix -> E.164, or null if it doesn't look like a real number.
 * - Already-E.164 input (starts with "+") is passed through after a digit
 *   count sanity check.
 * - +1 (NANP): accepts 10 digits, or 11 starting with a leading 1; loosely
 *   validates NANP shape (area code can't start 0 or 1).
 * - Trunk-zero prefixes (+44, +353, +61): a leading 0 is stripped before the
 *   prefix is prepended. NOT applied to +1.
 * - Everything else: prefix + digits, sanity-checked by overall length.
 */
export function normalizePhone(raw: string, phonePrefix: string): string | null {
  const trimmed = raw.trim();
  const digitsOnly = trimmed.replace(/\D/g, "");

  if (trimmed.startsWith("+")) {
    // Strip a trunk zero after a trunk-zero country code ("+44 07700..." is
    // common user input). Without this, +4407700x and +447700x normalize to
    // DIFFERENT strings — and the opted-out/suppressed compliance guards key
    // on exact phone equality, so the variant would bypass them (confirmed in
    // adversarial review). NSNs in these countries never start with 0, so the
    // strip cannot corrupt a legitimate number.
    let digits = digitsOnly;
    for (const p of TRUNK_ZERO_PREFIXES) {
      const cc = p.slice(1);
      if (digits.startsWith(`${cc}0`)) {
        digits = cc + digits.slice(cc.length + 1);
        break;
      }
    }
    const count = digits.length;
    return count >= 8 && count <= 15 ? `+${digits}` : null;
  }

  if (phonePrefix === "+1") {
    let digits = digitsOnly;
    if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
    if (digits.length !== 10) return null;
    if (digits[0] === "0" || digits[0] === "1") return null; // loose NANP area-code check
    return `+1${digits}`;
  }

  const usesTrunkZero = TRUNK_ZERO_PREFIXES.includes(phonePrefix);
  const digits = usesTrunkZero && digitsOnly.startsWith("0") ? digitsOnly.slice(1) : digitsOnly;
  const normalized = `${phonePrefix}${digits}`;
  const count = normalized.replace(/\D/g, "").length;
  return count >= 8 && count <= 15 ? normalized : null;
}

/** Real-length calendar bound for a month, generous on Feb (allows the 29th regardless of year — no year is stored for birthdays). */
export function daysInMonth(month: number): number {
  if (month === 2) return 29;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

/** True if (month, day) is a real calendar date by the daysInMonth rule above. Used to reject impossible birthday combos client- and server-side. */
export function isValidBirthday(month: number, day: number): boolean {
  return Number.isInteger(month) && Number.isInteger(day) && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(month);
}
