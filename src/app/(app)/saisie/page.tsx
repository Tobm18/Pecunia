import { PageHeader } from "@/components/ui/primitives";
import { EntrySession } from "./entry-session";

export const metadata = { title: "Saisie" };

export default function EntryPage() {
  return (
    <>
      <div>
        <PageHeader kicker="Session de saisie" title="Saisir" />
      </div>
      <EntrySession />
    </>
  );
}
