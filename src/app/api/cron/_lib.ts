/**
 * Shared cron auth — fail closed. Every /api/cron/* route calls this first:
 *   - CRON_SECRET unset → 503 (misconfigured deploy must never run crons)
 *   - Authorization header mismatch → 401
 */
export function requireCronAuth(req: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "CRON_SECRET not set" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
