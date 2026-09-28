import { PageHeader } from "@/components/ui/primitives";
import { EntrySession } from "./entry-session";

export const metadata = { title: "Saisie" };

export default function EntryPage() {
  return (
    <>
      <div className="pr-12 lg:pr-0">
        <PageHeader kicker="Session de saisie" title="Saisir" />
      </div>
      <EntrySession />
    </>
  );
}
