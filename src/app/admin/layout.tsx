import Link from "next/link";
import { getAdminUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await getAdminUser();
  if (!admin) redirect("/");

  const openAlertCount = await prisma.alert.count({
    where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
  });

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
          <TabsTrigger value="sources" asChild>
            <Link href="/admin/sources">Sources</Link>
          </TabsTrigger>
          <TabsTrigger value="alerts" asChild>
            <Link href="/admin/alerts" className="flex items-center gap-1">
              Alerts
              {openAlertCount > 0 && (
                <Badge variant="destructive" className="ml-1 text-xs">
                  {openAlertCount}
                </Badge>
              )}
            </Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {children}
    </div>
  );
}
