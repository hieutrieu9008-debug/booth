"use client";

import { useActionState } from "react";
import { Button, Card } from "@/components/kit";
import { provisionNumberAction, type ProvisionNumberFormState } from "./actions";

const initialState: ProvisionNumberFormState = { status: "idle" };

export function NumberCard({ restaurantId, slug, smsFrom }: { restaurantId: string; slug: string; smsFrom: string | null }) {
  const action = provisionNumberAction.bind(null, restaurantId, slug);
  const [state, formAction, pending] = useActionState(action, initialState);
  const activeNumber = state.status === "success" ? (state.phoneNumber ?? null) : smsFrom;

  return (
    <Card border shadow className="mt-6 max-w-md">
      <h2 className="font-display text-xl font-bold">Number</h2>
      {activeNumber ? (
        <>
          <p className="mt-2 text-lg font-semibold">{activeNumber}</p>
          <p className="mt-1 text-sm text-muted">Texting live.</p>
        </>
      ) : (
        <form action={formAction} className="mt-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Buying…" : "Buy this restaurant's number"}
          </Button>
        </form>
      )}
      {state.status === "error" && state.error && (
        <p className="mt-3 text-sm font-semibold text-coral-dark" role="alert">
          {state.error}
        </p>
      )}
    </Card>
  );
}
