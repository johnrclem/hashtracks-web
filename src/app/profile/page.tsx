import { getOrCreateUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  const user = await getOrCreateUser();
  if (!user) redirect("/sign-in");

  return (
    <div>
      <h1 className="text-2xl font-bold">Profile</h1>
      <div className="mt-4 space-y-2 text-sm">
        <p>
          <span className="font-medium">Hash Name:</span>{" "}
          {user.hashName ?? "Not set"}
        </p>
        <p>
          <span className="font-medium">Email:</span> {user.email}
        </p>
      </div>
      <p className="mt-4 text-muted-foreground">
        Profile editing coming soon.
      </p>
    </div>
  );
}
