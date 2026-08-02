import { hasInternalSession } from "./session";
import { AccessGate } from "./access-gate";

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const unlocked = await hasInternalSession();
  if (!unlocked) return <AccessGate />;

  return <div className="min-h-screen bg-paper text-ink">{children}</div>;
}
