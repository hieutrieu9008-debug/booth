import { Card, Skeleton } from "@/components/kit";
export default function Loading() { return <main className="min-h-screen bg-ink px-6 py-10"><div className="mx-auto max-w-md space-y-6 text-center"><Skeleton variant="line" className="mx-auto h-8 w-3/4" /><Skeleton variant="line" className="mx-auto w-2/3" /><Card><Skeleton className="mx-auto !h-[240px] !w-[240px]" /></Card></div></main>; }
