"use client";
import { useEffect } from "react";
import { establishMemberSession } from "./actions";

/** Fire-and-forget: sets the bl_member session cookie once the card loads (WS-B item 1). Renders nothing. */
export function MemberSessionEffect({ token }: { token: string }) {
  useEffect(() => {
    void establishMemberSession(token);
  }, [token]);
  return null;
}
