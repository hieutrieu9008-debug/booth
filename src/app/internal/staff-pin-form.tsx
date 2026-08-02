"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button, Field } from "@/components/kit";
import { addStaffPinAction, type StaffPinState } from "./actions";

const initialState: StaffPinState = { status: "idle" };

export function StaffPinForm({ restaurantId, slug }: { restaurantId: string; slug: string }) {
  const action = addStaffPinAction.bind(null, restaurantId, slug);
  const [state, formAction, pending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state.status]);

  return (
    <form ref={formRef} action={formAction} className="mt-4 flex items-end gap-3">
      <Field id="label" name="label" label="Label" placeholder="Front till" required className="flex-1" />
      <Field id="pin" name="pin" label="PIN" placeholder="1234" inputMode="numeric" required className="w-28" />
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add"}
      </Button>
      {state.status === "error" && state.error && (
        <p className="text-sm font-semibold text-coral-dark" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
