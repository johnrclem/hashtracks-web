import { getOrCreateUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { KennelRequestForm } from "@/components/kennels/KennelRequestForm";
import { PageHeader } from "@/components/layout/PageHeader";

export default async function KennelRequestPage() {
  const user = await getOrCreateUser();
  if (!user) redirect("/sign-in");

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PageHeader
        title="Request a Kennel"
        description="Don't see your kennel in the directory? Submit a request and we'll add it."
      />

      <KennelRequestForm />
    </div>
  );
}
