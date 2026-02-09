import Link from "next/link";
import { getAdminUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await getAdminUser();
  if (!admin) redirect("/");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin</h1>
      </div>

      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests" asChild>
            <Link href="/admin/requests">Requests</Link>
          </TabsTrigger>
          <TabsTrigger value="kennels" asChild>
            <Link href="/admin/kennels">Kennels</Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {children}
    </div>
  );
}
