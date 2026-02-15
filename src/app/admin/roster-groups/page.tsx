import { getAdminUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { RosterGroupsAdmin } from "@/components/admin/RosterGroupsAdmin";
import { getRosterGroups } from "./actions";

export default async function RosterGroupsPage() {
  const admin = await getAdminUser();
  if (!admin) redirect("/");

  const result = await getRosterGroups();
  if (result.error) return <p className="text-destructive">{result.error}</p>;

  return <RosterGroupsAdmin groups={result.data ?? []} />;
}
