import { getAdminUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { RosterGroupsAdmin } from "@/components/admin/RosterGroupsAdmin";
import { getRosterGroups, getRosterGroupRequests } from "./actions";

export default async function RosterGroupsPage() {
  const admin = await getAdminUser();
  if (!admin) redirect("/");

  const [groupsResult, requestsResult] = await Promise.all([
    getRosterGroups(),
    getRosterGroupRequests(),
  ]);

  if (groupsResult.error) return <p className="text-destructive">{groupsResult.error}</p>;

  return (
    <RosterGroupsAdmin
      groups={groupsResult.data ?? []}
      pendingRequests={requestsResult.data ?? []}
    />
  );
}
