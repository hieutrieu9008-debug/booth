import { NextResponse } from "next/server";
import { requireOwnerRestaurant } from "@/lib/owner";
import { exportMemberData } from "@/lib/booth/privacy";

/**
 * Owner-triggered diner data export (Task C, UK GDPR right to access) —
 * same auth as every other member-scoped route in this app:
 * requireOwnerRestaurant() redirects to /login with no session, and
 * exportMemberData tenant-scopes every query so a cross-tenant id 404s
 * instead of leaking another restaurant's diner.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwnerRestaurant();
  const { id } = await params;

  const data = await exportMemberData(owner.id, id);
  if (!data) return new NextResponse(null, { status: 404 });

  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="booth-diner-data-${id}.json"`,
    },
  });
}
