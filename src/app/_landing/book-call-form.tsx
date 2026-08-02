"use client";
import { useActionState, useState } from "react";
import { Button, Card, Field, PhoneInput, Section, WaveDivider } from "@/components/kit";
import { bookCallAction, type BookCallState } from "./actions";

const initialState: BookCallState = { status: "idle" };

export function BookCallForm() {
  const [phone, setPhone] = useState("");
  const [state, action, pending] = useActionState(bookCallAction, initialState);

  return (
    <>
    <WaveDivider fill="var(--ink)" className="relative z-10 -mt-16 sm:-mt-24" />
    <Section bg="ink" id="book">
      <div className="mx-auto max-w-xl">
        <h2 className="text-center font-display text-4xl font-extrabold leading-tight text-cream sm:text-5xl">
          Fill your quiet nights.
        </h2>
        <p className="mt-4 text-center text-lg text-cream/90">
          A 15-minute call. We set everything up for you — you don&apos;t touch any software.
        </p>

        {state.status === "success" ? (
          <Card bg="white" shadow border className="mt-10 text-center">
            <p className="font-display text-2xl font-extrabold text-ink">Done. We&apos;ll text you to find a time.</p>
          </Card>
        ) : (
          <form
            action={action}
            className="mt-10 space-y-5 rounded-card border-2 border-cream/20 bg-ink p-6 sm:p-8 [&_label]:!text-cream [&_p[role='alert']]:!text-butter"
          >
            <Field id="name" name="name" label="Name" required autoComplete="name" error={state.fieldErrors?.name} />
            <Field
              id="restaurantName"
              name="restaurantName"
              label="Restaurant name"
              required
              autoComplete="organization"
              error={state.fieldErrors?.restaurantName}
            />
            <div>
              <PhoneInput id="phone" name="phone" label="Mobile number" required value={phone} onChange={setPhone} />
              {state.fieldErrors?.phone && (
                <p role="alert" className="mt-1.5 text-sm font-semibold text-butter">
                  {state.fieldErrors.phone}
                </p>
              )}
            </div>
            <Field
              id="email"
              name="email"
              label="Email (optional)"
              type="email"
              autoComplete="email"
              error={state.fieldErrors?.email}
            />
            {state.error && (
              <p role="alert" className="text-sm font-semibold text-butter">
                {state.error}
              </p>
            )}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Sending…" : "Book a 15-minute call"}
            </Button>
          </form>
        )}
      </div>
    </Section>
    </>
  );
}
