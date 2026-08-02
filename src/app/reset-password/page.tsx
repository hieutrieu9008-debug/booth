"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Section } from "@/components/kit";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.push("/dashboard");
  }

  return (
    <Section bg="coral" className="flex min-h-screen items-center justify-center">
      <Card shadow border className="w-full max-w-sm">
        <h1 className="font-display text-2xl font-extrabold text-ink">Set a new password</h1>
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <Field
            id="password"
            label="New password"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <p className="text-sm font-semibold text-coral-dark" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save password"}
          </Button>
        </form>
      </Card>
    </Section>
  );
}
