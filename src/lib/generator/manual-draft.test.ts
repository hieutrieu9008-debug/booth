import { describe, it, expect } from "vitest";
import { manualDraft } from "./manual-draft";
import { generatedSetupSchema } from "./schema";
import { joinPageSchema } from "@/lib/booth/programs";
import { EMPTY_INTAKE, type IntakeInput } from "./types";

describe("manualDraft — canonical shapes (WS5 item 5)", () => {
  it("emits a birthday config with mode:'window' and a come_back config with blocks-with-ids", () => {
    const draft = manualDraft(EMPTY_INTAKE);

    expect(draft.birthday.config.mode).toBe("window");
    expect(draft.come_back.config.blocks).toHaveLength(1);
    expect(draft.come_back.config.blocks[0].id).toBe("b1");

    // The whole draft must satisfy the draft schema (which mirrors the
    // canonical shapes: options arrays, blocks with ids, birthday mode).
    expect(() => generatedSetupSchema.parse(draft)).not.toThrow();
  });

  it("emits a join_page built from the intake's lead-magnet choice, using the real WS1 joinPageSchema", () => {
    const intake: IntakeInput = { ...EMPTY_INTAKE, leadMagnet: { choice: "custom", headline: "Join us", customText: "Get a free starter" } };
    const draft = manualDraft(intake);

    expect(draft.join_page).toEqual({ magnet: "custom", custom_text: "Get a free starter", headline: "Join us" });
    expect(() => joinPageSchema.parse(draft.join_page)).not.toThrow();
  });

  it("prefers an included structured menu item over the free-text giveaway field", () => {
    const intake: IntakeInput = {
      ...EMPTY_INTAKE,
      giveawayItems: "side salad",
      menuItems: [
        { name: "Garlic naan", price: 4.5, included: true },
        { name: "Mango kulfi", price: 5.5, included: false },
      ],
    };
    const draft = manualDraft(intake);

    expect(draft.welcome.config.reward).toContain("Garlic naan");
    expect(draft.welcome.config.reward).not.toContain("Mango kulfi");
  });
});
