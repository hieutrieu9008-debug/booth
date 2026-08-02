import { Card, Section, Skeleton } from "@/components/kit";

export default function Loading() {
  return (
    <Section bg="paper">
      <Skeleton variant="line" className="w-1/3" />
      <div className="mt-8 grid gap-6 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} shadow border>
            <Skeleton variant="line" className="w-2/3" />
            <Skeleton className="mt-4 !h-16" />
            <Skeleton variant="line" className="mt-4 w-1/2" />
          </Card>
        ))}
      </div>
      <div className="mt-10">
        <Skeleton variant="line" className="w-1/4" />
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} shadow border>
              <Skeleton variant="line" className="w-1/3" />
              <Skeleton className="mt-4 !h-32" />
            </Card>
          ))}
        </div>
      </div>
    </Section>
  );
}
