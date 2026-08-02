"use client";

import { useState } from "react";
import { Button, Card } from "@/components/kit";
import type { MenuItem } from "@/lib/booth/programs";
import { parseMenuAction, saveMenuItemsAction, type SaveMenuState } from "./actions";

function inputClass() {
  return "min-h-9 w-full rounded-button border-2 border-line bg-cream px-3 text-sm text-ink";
}

export function MenuImportSection({
  restaurantId,
  slug,
  menuItems,
}: {
  restaurantId: string;
  slug: string;
  menuItems: MenuItem[];
}) {
  const [pasteText, setPasteText] = useState("");
  const [rows, setRows] = useState<MenuItem[]>(menuItems);
  const [parsing, setParsing] = useState(false);
  const [parseNotice, setParseNotice] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<SaveMenuState>({ status: "idle" });

  async function handleParse() {
    if (!pasteText.trim()) return;
    setParsing(true);
    setParseNotice(null);
    setParseError(null);
    try {
      const result = await parseMenuAction(pasteText);
      setRows((prev) => [...prev, ...result.items]);
      setParseNotice(result.notice);
    } catch (caught) {
      setParseError(caught instanceof Error ? caught.message : "Parsing failed — try again, or add rows manually.");
    } finally {
      setParsing(false);
    }
  }

  function updateRow(i: number, patch: Partial<MenuItem>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, j) => j !== i));
  }

  function addRow() {
    setRows((prev) => [...prev, { name: "" }]);
  }

  async function handleSave() {
    setSaving(true);
    setSaveState({ status: "idle" });
    try {
      const cleaned = rows
        .map((r) => ({ ...r, name: r.name.trim() }))
        .filter((r) => r.name.length > 0);
      const result = await saveMenuItemsAction(restaurantId, slug, cleaned);
      setSaveState(result);
      if (result.status === "success") setRows(cleaned);
    } catch (caught) {
      setSaveState({ status: "error", error: caught instanceof Error ? caught.message : "Save failed — try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card border shadow className="mt-6">
      <h2 className="font-display text-xl font-bold">Menu import</h2>
      <p className="mt-1 text-sm text-muted">
        Paste a menu — plain text or rough copy-paste. Parsed items feed the setup generator.
      </p>

      <textarea
        value={pasteText}
        onChange={(e) => setPasteText(e.target.value)}
        placeholder={"e.g.\nSTARTERS\nGarlic bread £4.50\n\nMains:\nButter chicken 13.50"}
        className="mt-3 min-h-32 w-full rounded-button border-2 border-line bg-cream px-4 py-2 text-sm text-ink placeholder:text-muted"
      />
      <Button type="button" variant="secondary" className="mt-2 w-fit" disabled={parsing || !pasteText.trim()} onClick={handleParse}>
        {parsing ? "Parsing…" : "Parse menu"}
      </Button>
      {parseNotice && <p className="mt-2 text-sm font-semibold text-ink">{parseNotice}</p>}
      {parseError && (
        <p className="mt-2 text-sm font-semibold text-coral-dark" role="alert">
          {parseError}
        </p>
      )}

      {rows.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-line text-left">
                <th className="py-2 pr-2 font-semibold text-ink">Name</th>
                <th className="py-2 pr-2 font-semibold text-ink">Price</th>
                <th className="py-2 pr-2 font-semibold text-ink">Category</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-line/40">
                  <td className="py-1.5 pr-2">
                    <input value={row.name} onChange={(e) => updateRow(i, { name: e.target.value })} className={inputClass()} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={row.price ?? ""}
                      onChange={(e) => updateRow(i, { price: e.target.value === "" ? undefined : Number(e.target.value) })}
                      className={`${inputClass()} w-24`}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input value={row.category ?? ""} onChange={(e) => updateRow(i, { category: e.target.value || undefined })} className={inputClass()} />
                  </td>
                  <td className="py-1.5">
                    <Button type="button" variant="ghost" onClick={() => removeRow(i)}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={addRow}>
          Add row
        </Button>
        <Button type="button" disabled={saving} onClick={handleSave}>
          {saving ? "Saving…" : "Save menu"}
        </Button>
      </div>
      {saveState.status === "error" && (
        <p className="mt-2 text-sm font-semibold text-coral-dark" role="alert">
          {saveState.error}
        </p>
      )}
      {saveState.status === "success" && <p className="mt-2 text-sm font-semibold text-ink">Menu saved.</p>}
    </Card>
  );
}
