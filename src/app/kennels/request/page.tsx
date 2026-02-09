import { getOrCreateUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { KennelRequestForm } from "@/components/kennels/KennelRequestForm";

export default async function KennelRequestPage() {
  const user = await getOrCreateUser();
  if (!user) redirect("/sign-in");

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Request a Kennel</h1>
        <p className="mt-1 text-muted-foreground">
          Don&apos;t see your kennel in the directory? Submit a request and
          we&apos;ll add it.
        </p>
      </div>

      <KennelRequestForm />
    </div>
  );
}
