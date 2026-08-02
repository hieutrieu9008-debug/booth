"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Section } from "@/components/kit";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    router.push("/dashboard");
  }

  async function handleForgotPassword() {
    if (!email) {
      setError("Enter your email above first.");
      return;
    }
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/reset-password`,
    });
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setResetSent(true);
  }

  return (
    <Section bg="coral" className="flex min-h-screen items-center justify-center">
      <Card shadow border className="w-full max-w-sm">
        <h1 className="font-display text-2xl font-extrabold text-ink">Owner login</h1>
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <Field
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Field
            id="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <p className="text-sm font-semibold text-coral-dark" role="alert">
              {error}
            </p>
          )}
          {resetSent && <p className="text-sm font-semibold text-ink">Check your email for a reset link.</p>}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
          <button
            type="button"
            onClick={handleForgotPassword}
            className="text-sm font-semibold text-muted underline underline-offset-2"
          >
            Forgot password?
          </button>
        </form>
      </Card>
    </Section>
  );
}
