import { Card, Skeleton } from "@/components/kit";
export default function Loading() { return <main className="min-h-screen bg-paper px-6 py-10"><div className="mx-auto max-w-md space-y-5"><Skeleton variant="line" className="h-10 w-2/3" /><Skeleton variant="line" className="w-1/2" /><Card><Skeleton /><Skeleton variant="line" className="mt-5" /></Card></div></main>; }
