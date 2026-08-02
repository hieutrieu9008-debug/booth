"use server";

import { redirect } from "next/navigation";
import { setInternalSessionCookie } from "./session";

export type GateState = { error: string | null };

export async function submitAccessCode(_prevState: GateState, formData: FormData): Promise<GateState> {
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "Enter the access code." };

  const expected = process.env.INTERNAL_ACCESS_CODE;
  if (!expected) return { error: "INTERNAL_ACCESS_CODE is not configured." };
  if (code !== expected) return { error: "Wrong code." };

  await setInternalSessionCookie();
  redirect("/internal");
}
