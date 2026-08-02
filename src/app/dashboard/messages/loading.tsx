import { Card, Section, Skeleton } from "@/components/kit";

export default function Loading() {
  return (
    <Section bg="paper">
      <Skeleton variant="line" className="w-1/3" />
      <Card shadow border className="mt-8">
        <Skeleton variant="line" className="w-1/4" />
        <Skeleton className="mt-4 !h-32" />
      </Card>
    </Section>
  );
}
