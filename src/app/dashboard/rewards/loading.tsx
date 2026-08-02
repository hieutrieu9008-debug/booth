import { Card, Section, Skeleton } from "@/components/kit";

export default function Loading() {
  return (
    <Section bg="paper">
      <Skeleton variant="line" className="w-1/3" />
      <div className="mt-8 space-y-6">
        {[0, 1, 2].map((i) => (
          <Card key={i} shadow border>
            <Skeleton variant="line" className="w-1/4" />
            <Skeleton variant="line" className="mt-2 w-1/2" />
            <Skeleton className="mt-4 !h-10" />
          </Card>
        ))}
      </div>
    </Section>
  );
}
