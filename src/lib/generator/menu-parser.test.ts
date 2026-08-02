import { describe, it, expect } from "vitest";
import { parseMenuText } from "./menu-parser";

// Labeled example menu — a rough paste like an operator would actually send
// over from a call (mixed separators, one heading with a colon, one without).
const EXAMPLE_MENU = `
STARTERS
Garlic bread £4.50
Vegetable samosa (2pc) - £5

Mains:
Butter chicken 13.50
Lamb rogan josh - 14.50

Desserts
Mango kulfi £5.50
House chai £3
`;

describe("parseMenuText", () => {
  it("parses a labeled example menu into structured items with categories and prices", () => {
    const items = parseMenuText(EXAMPLE_MENU);

    expect(items).toEqual([
      { name: "Garlic bread", price: 4.5, category: "STARTERS" },
      { name: "Vegetable samosa (2pc)", price: 5, category: "STARTERS" },
      { name: "Butter chicken", price: 13.5, category: "Mains" },
      { name: "Lamb rogan josh", price: 14.5, category: "Mains" },
      { name: "Mango kulfi", price: 5.5, category: "Desserts" },
      { name: "House chai", price: 3, category: "Desserts" },
    ]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseMenuText("   \n\n  ")).toEqual([]);
  });

  it("skips heading-only text with no items", () => {
    expect(parseMenuText("STARTERS\nMains\nDesserts")).toEqual([]);
  });

  it("documented limitation: a priceless line is indistinguishable from a heading", () => {
    expect(parseMenuText("Extras\nHouse chai (no price given)")).toEqual([]);
  });
});
