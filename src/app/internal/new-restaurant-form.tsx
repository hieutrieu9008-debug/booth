"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button, Field } from "@/components/kit";
import { createRestaurantAction, type CreateRestaurantState } from "./actions";

const initialState: CreateRestaurantState = { status: "idle" };

// Operator must consciously choose these — no preselected value. Sensible
// option lists only; not exhaustive.
const PHONE_PREFIXES = ["+44", "+1", "+353", "+61"];
const CURRENCIES = ["GBP", "USD", "EUR", "AUD"];
const TIMEZONES = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "Australia/Sydney",
];

function SelectField({
  id,
  name,
  label,
  options,
  error,
}: {
  id: string;
  name: string;
  label: string;
  options: string[];
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue=""
        required
        aria-invalid={!!error}
        className="min-h-11 rounded-button border-2 border-line bg-cream px-4 text-base text-ink"
      >
        <option value="" disabled>
          Select…
        </option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      {error && <p className="text-sm font-semibold text-coral-dark">{error}</p>}
    </div>
  );
}

export function NewRestaurantForm() {
  const [state, formAction, pending] = useActionState(createRestaurantAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state.status]);

  return (
    <form ref={formRef} action={formAction} className="mt-4 flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" name="name" label="Restaurant name" required error={state.fieldErrors?.name} />
        <Field id="slug" name="slug" label="Slug" placeholder="demo-kitchen" required error={state.fieldErrors?.slug} />
        <SelectField id="timezone" name="timezone" label="Timezone" options={TIMEZONES} error={state.fieldErrors?.timezone} />
        <SelectField id="phone_prefix" name="phone_prefix" label="Phone prefix" options={PHONE_PREFIXES} error={state.fieldErrors?.phone_prefix} />
        <SelectField id="currency" name="currency" label="Currency" options={CURRENCIES} error={state.fieldErrors?.currency} />
        <Field id="avg_ticket" name="avg_ticket" label="Avg ticket" type="number" step="0.01" min="0" error={state.fieldErrors?.avg_ticket} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="visit_mode" className="text-sm font-semibold text-ink">
            Visit mode
          </label>
          <select
            id="visit_mode"
            name="visit_mode"
            defaultValue="staff_scan"
            className="min-h-11 rounded-button border-2 border-line bg-cream px-4 text-base text-ink"
          >
            <option value="staff_scan">Staff scan</option>
            <option value="self_scan">Self scan</option>
            <option value="both">Both</option>
          </select>
          {state.fieldErrors?.visit_mode && <p className="text-sm font-semibold text-coral-dark">{state.fieldErrors.visit_mode}</p>}
        </div>
        <Field id="brand_color" name="brand_color" label="Brand colour" type="color" defaultValue="#F26649" />
      </div>

      <p className="mt-2 text-sm font-semibold text-ink">Optional: invite the owner</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="owner_email"
          name="owner_email"
          label="Owner email"
          type="email"
          hint="They get a set-password link — no temp passwords."
        />
      </div>

      {state.status === "error" && state.error && (
        <p className="text-sm font-semibold text-coral-dark" role="alert">
          {state.error}
        </p>
      )}
      {state.status === "success" && <p className="text-sm font-semibold text-ink">Restaurant created.</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create restaurant"}
      </Button>
    </form>
  );
}
