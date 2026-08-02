import "server-only";
import OpenAI from "openai";
import { generatedSetupSchema, tenantSetupJsonSchema, joinPageFromLeadMagnet, type GeneratedSetup } from "./schema";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import type { IntakeInput } from "./types";
import { menuItemsSchema, type MenuItem } from "@/lib/booth/programs";

/**
 * Calls OpenAI for a structured tenant-setup draft. The client is
 * constructed HERE, inside the request handler, not at module scope — the
 * app (and its build) must work with no OPENAI_API_KEY set.
 */
export async function generateSetupWithAI(intake: IntakeInput): Promise<GeneratedSetup> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const client = new OpenAI({ apiKey });
  const model = process.env.AI_MODEL || "gpt-4o-mini";

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(intake) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "tenant_setup",
        strict: true,
        schema: tenantSetupJsonSchema,
      },
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from model");

  const parsedJson = JSON.parse(content) as Record<string, unknown>;
  // join_page isn't part of the AI's structured output (see schema.ts docstring) —
  // it's filled deterministically from the intake's lead-magnet choice.
  return generatedSetupSchema.parse({ ...parsedJson, join_page: joinPageFromLeadMagnet(intake.leadMagnet) });
}

const menuJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          price: { type: ["number", "null"] },
          category: { type: ["string", "null"] },
        },
        required: ["name", "price", "category"],
      },
    },
  },
  required: ["items"],
} as const;

/**
 * AI-assist fallback for menu import (WS5 item 3) — only called when the
 * deterministic parser (menu-parser.ts) finds zero items AND OPENAI_API_KEY
 * is set. Extracts {name, price?, category?} from unstructured pasted text
 * without inventing dishes or prices not present in the input.
 */
export async function parseMenuWithAI(text: string): Promise<MenuItem[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const client = new OpenAI({ apiKey });
  const model = process.env.AI_MODEL || "gpt-4o-mini";

  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "Extract menu items from pasted restaurant menu text. Use ONLY dishes and prices present in the text — never invent a name or price. Omit price/category when not present in the text (use null). Return only the structured JSON.",
      },
      { role: "user", content: text },
    ],
    response_format: { type: "json_schema", json_schema: { name: "menu_items", strict: true, schema: menuJsonSchema } },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from model");

  const parsedJson = JSON.parse(content) as { items: { name: string; price: number | null; category: string | null }[] };
  const items = parsedJson.items.map((i) => ({
    name: i.name,
    ...(i.price !== null ? { price: i.price } : {}),
    ...(i.category !== null ? { category: i.category } : {}),
  }));
  return menuItemsSchema.parse(items);
}
