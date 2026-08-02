import { Card, Section, Skeleton } from "@/components/kit";

export default function Loading() {
  return (
    <Section bg="paper">
      <Skeleton variant="line" className="w-1/3" />
      <div className="mt-8 grid gap-8 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i} shadow border className="text-center">
            <Skeleton className="mx-auto !h-40 !w-40" />
          </Card>
        ))}
      </div>
    </Section>
  );
}
