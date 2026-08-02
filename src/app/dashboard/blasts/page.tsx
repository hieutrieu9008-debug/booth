import { redirect } from "next/navigation";

/** "Blasts" was renamed to "Messages" (docs/SPEC-WS4.md #2) — old bookmarks/links land here and bounce onward. */
export default function BlastsRedirect() {
  redirect("/dashboard/messages");
}
