import { Card, PageHeader } from "@/components/ui/primitives";

/** Écran des modules prévus en version 2 (cf. cahier des charges, « Évolutions »). */
export function ComingSoon({ kicker, title, features }: { kicker: string; title: string; features: string[] }) {
  return (
    <>
      <div className="pr-12 lg:pr-0">
        <PageHeader kicker={kicker} title={title} />
      </div>
      <Card>
        <p className="font-semibold">Ce module arrive dans la prochaine version.</p>
        <ul className="mt-3 list-disc pl-5 text-sm text-n-700">
          {features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </Card>
    </>
  );
}
