import { Card, Section, Skeleton } from "@/components/kit";

export default function Loading() {
  return (
    <Section bg="paper">
      <Skeleton variant="line" className="w-1/3" />
      <div className="mt-8 space-y-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} border className="!p-4">
            <Skeleton variant="line" className="w-1/3" />
          </Card>
        ))}
      </div>
    </Section>
  );
}
