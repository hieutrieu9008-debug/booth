import type { MenuItem } from "@/lib/booth/programs";

/**
 * Deterministic menu-text parser (WS5 item 3). Turns a rough paste — plain
 * text, one dish/price per line, occasional category headings — into
 * structured MenuItem rows. No AI involved; this is the first pass the
 * operator reviews/edits before saving. AI-assist (src/lib/generator/ai.ts
 * parseMenuWithAI) is a fallback for when this yields nothing usable.
 *
 * Heuristics (documented, not "clever"):
 * - A line with no digits and under 40 chars is treated as a category
 *   heading (e.g. "STARTERS", "Mains:") and doesn't become an item.
 * - Otherwise the line's trailing/embedded price ("£4.50", "4.50", "(4.50)")
 *   is extracted; whatever's left (minus separator punctuation) is the name.
 * - Blank lines are skipped. Lines with no price and no name are skipped.
 */

const HEADING_MAX_LEN = 40;
const PRICE_RE = /£?\s*(\d+(?:\.\d{1,2})?)\s*$/;
const PRICE_ANYWHERE_RE = /£\s*(\d+(?:\.\d{1,2})?)/;

function looksLikeHeading(line: string): boolean {
  if (line.length > HEADING_MAX_LEN) return false;
  if (/\d/.test(line)) return false;
  return true;
}

function stripHeadingPunctuation(line: string): string {
  return line.replace(/:\s*$/, "").trim();
}

function extractPrice(line: string): { name: string; price?: number } {
  const trailing = line.match(PRICE_RE);
  if (trailing) {
    const price = Number(trailing[1]);
    const name = line.slice(0, trailing.index).trim();
    return { name: cleanName(name), price };
  }
  const anywhere = line.match(PRICE_ANYWHERE_RE);
  if (anywhere && anywhere.index !== undefined) {
    const price = Number(anywhere[1]);
    const name = (line.slice(0, anywhere.index) + line.slice(anywhere.index + anywhere[0].length)).trim();
    return { name: cleanName(name), price };
  }
  return { name: cleanName(line) };
}

function cleanName(name: string): string {
  return name
    .replace(/[.\-–—…]+$/, "") // trailing leader dots / dashes before a stripped price
    .replace(/^[.\-–—…()]+|[()]+$/g, "")
    .trim();
}

export function parseMenuText(text: string): MenuItem[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const items: MenuItem[] = [];
  let currentCategory: string | undefined;

  for (const line of lines) {
    if (looksLikeHeading(line)) {
      currentCategory = stripHeadingPunctuation(line);
      continue;
    }
    const { name, price } = extractPrice(line);
    if (!name) continue;
    items.push({
      name,
      ...(price !== undefined ? { price } : {}),
      ...(currentCategory ? { category: currentCategory } : {}),
    });
  }

  return items;
}
