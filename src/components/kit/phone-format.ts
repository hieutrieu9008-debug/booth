/** UK mobile national-format grouping: 07123 456789 (5 + 6 digits, leading 0 kept). */
const UK_GROUPS = [5, 6];

/**
 * Pure formatter — strips non-digits, caps at the group total, inserts a
 * space between groups. No "use client" here (unlike phone-input.tsx) so
 * server components (e.g. the member-card page's backup-code display) can
 * call it directly.
 */
export function formatUkMobile(raw: string, groups: number[] = UK_GROUPS): string {
  const max = groups.reduce((a, b) => a + b, 0);
  const digits = raw.replace(/\D/g, "").slice(0, max);
  let out = "";
  let i = 0;
  for (const g of groups) {
    const chunk = digits.slice(i, i + g);
    if (!chunk) break;
    out += (out ? " " : "") + chunk;
    i += g;
  }
  return out;
}

/**
 * US/NANP national-format grouping while typing: (XXX) XXX-XXXX, built up
 * progressively as digits arrive (mirrors formatUkMobile's partial-input
 * behavior). No "use client" here for the same server-component reason above.
 */
export function formatUsMobile(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
