"use client";

import { useState, useTransition } from "react";
import { Button, Card, Field } from "@/components/kit";
import type { StaffPinWithActivity } from "./data";
import { addStaffPin, deactivateStaffPin } from "./actions";

const formatDate = (v: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(v));

function formatLastActive(v: string | null): string {
  if (!v) return "Never used";
  const mins = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs === 1 ? "1 hr ago" : `${hrs} hrs ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function AddPinForm({ onAdded }: { onAdded: (pin: string, label: string) => void }) {
  const [label, setLabel] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addStaffPin(label, pin || undefined);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onAdded(result.pin, label);
      setLabel("");
      setPin("");
    });
  }

  return (
    <Card border className="!p-4">
      <p className="font-display text-base font-bold">Add a PIN</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field id="pin-label" label="Label" placeholder="Front till" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Field
          id="pin-value"
          label="PIN (4-6 digits, optional, we'll generate one)"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
        />
      </div>
      {error && <p className="mt-2 text-sm font-semibold text-coral-dark">{error}</p>}
      <Button className="mt-3" disabled={pending} onClick={submit}>
        Add PIN
      </Button>
    </Card>
  );
}

export function PinsClient({ initialPins }: { initialPins: StaffPinWithActivity[] }) {
  const [pins, setPins] = useState(initialPins);
  const [revealed, setRevealed] = useState<{ label: string; pin: string } | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleAdded(pin: string, label: string) {
    setRevealed({ pin, label });
    // Server truth (active/created_at/id) arrives via revalidatePath on next
    // navigation; optimistic entry keeps the list responsive meanwhile.
    setPins((prev) => [
      {
        id: `pending-${Date.now()}`,
        restaurant_id: "",
        label,
        pin_hash: "",
        active: true,
        created_at: new Date().toISOString(),
        activity: { visits: 0, redemptions: 0, undos: 0, lastActiveAt: null },
      },
      ...prev,
    ]);
  }

  function deactivate(id: string) {
    setDeactivateError(null);
    setPins((prev) => prev.map((p) => (p.id === id ? { ...p, active: false } : p)));
    startTransition(async () => {
      const result = await deactivateStaffPin(id);
      if (!result.ok) {
        // Roll back the optimistic flip — the server said no, so the PIN is
        // still active and staff can still use it.
        setPins((prev) => prev.map((p) => (p.id === id ? { ...p, active: true } : p)));
        setDeactivateError(result.error);
      }
    });
  }

  return (
    <div className="mt-8 space-y-6">
      {deactivateError && (
        <Card border className="!p-4">
          <p role="alert" className="text-sm font-semibold text-coral-dark">
            Couldn&apos;t deactivate that PIN: {deactivateError}
          </p>
        </Card>
      )}
      {revealed && (
        <Card border className="!bg-butter !p-4">
          <p className="font-display text-lg font-bold">
            {revealed.label}: {revealed.pin}
          </p>
          <p className="mt-1 text-sm font-semibold">Write it down now. We only show it once.</p>
        </Card>
      )}

      <AddPinForm onAdded={handleAdded} />

      <div className="space-y-3">
        {pins.length === 0 && <p className="text-base text-muted">No staff PINs yet.</p>}
        {pins.map((pin) => (
          <Card key={pin.id} border className="!p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-display text-base font-bold">{pin.label}</p>
                <p className="text-sm text-muted">
                  {pin.active ? "Active" : "Deactivated"} · added {formatDate(pin.created_at)}
                </p>
              </div>
              {pin.active && (
                <Button variant="secondary" onClick={() => deactivate(pin.id)}>
                  Deactivate
                </Button>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t-2 border-line pt-3 text-sm sm:grid-cols-4">
              <p>
                <span className="font-display font-bold text-ink">{pin.activity.visits}</span>{" "}
                <span className="text-muted">visits</span>
              </p>
              <p>
                <span className="font-display font-bold text-ink">{pin.activity.redemptions}</span>{" "}
                <span className="text-muted">redemptions</span>
              </p>
              <p>
                <span className="font-display font-bold text-ink">{pin.activity.undos}</span>{" "}
                <span className="text-muted">undos</span>
              </p>
              <p className="text-muted">{formatLastActive(pin.activity.lastActiveAt)}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
