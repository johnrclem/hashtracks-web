import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { SuggestKennelForm } from "@/components/suggest/SuggestKennelForm";

export const metadata: Metadata = {
  title: "Suggest a Kennel | HashTracks",
};

export default function SuggestPage() {
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Suggest a Kennel"
        description="Don't see your kennel? Tell us about it and we'll look into adding it to HashTracks."
      />
      <Card>
        <CardContent>
          <SuggestKennelForm />
        </CardContent>
      </Card>
    </div>
  );
}
