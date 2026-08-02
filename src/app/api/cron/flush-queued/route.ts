import { flushQueued } from "@/lib/sms/dispatch";
import { requireCronAuth } from "../_lib";

export async function GET(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const counters = await flushQueued();
  return Response.json(counters);
}
