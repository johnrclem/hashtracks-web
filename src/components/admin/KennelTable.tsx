"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteKennel } from "@/app/admin/kennels/actions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KennelForm } from "./KennelForm";
import { toast } from "sonner";

type Kennel = {
  id: string;
  shortName: string;
  fullName: string;
  region: string;
  country: string;
  description: string | null;
  website: string | null;
  aliases: string[];
  _count: { members: number; aliases: number };
  // Profile fields
  scheduleDayOfWeek: string | null;
  scheduleTime: string | null;
  scheduleFrequency: string | null;
  scheduleNotes: string | null;
  facebookUrl: string | null;
  instagramHandle: string | null;
  twitterHandle: string | null;
  discordUrl: string | null;
  mailingListUrl: string | null;
  contactEmail: string | null;
  contactName: string | null;
  hashCash: string | null;
  paymentLink: string | null;
  foundedYear: number | null;
  logoUrl: string | null;
  dogFriendly: boolean | null;
  walkersWelcome: boolean | null;
};

interface KennelTableProps {
  kennels: Kennel[];
}

export function KennelTable({ kennels }: KennelTableProps) {
  if (kennels.length === 0) {
    return <p className="text-sm text-muted-foreground">No kennels yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Short Name</TableHead>
          <TableHead>Full Name</TableHead>
          <TableHead>Region</TableHead>
          <TableHead className="text-center">Aliases</TableHead>
          <TableHead className="text-center">Subscribers</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {kennels.map((kennel) => (
          <KennelRow key={kennel.id} kennel={kennel} />
        ))}
      </TableBody>
    </Table>
  );
}

function KennelRow({ kennel }: { kennel: Kennel }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleDelete() {
    if (!confirm(`Delete "${kennel.shortName}"? This cannot be undone.`)) {
      return;
    }

    startTransition(async () => {
      const result = await deleteKennel(kennel.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Kennel deleted");
      }
      router.refresh();
    });
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{kennel.shortName}</TableCell>
      <TableCell>{kennel.fullName}</TableCell>
      <TableCell>
        <Badge variant="outline">{kennel.region}</Badge>
      </TableCell>
      <TableCell className="text-center">{kennel._count.aliases}</TableCell>
      <TableCell className="text-center">{kennel._count.members}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <KennelForm
            kennel={kennel}
            trigger={<Button size="sm" variant="outline">Edit</Button>}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={handleDelete}
          >
            {isPending ? "..." : "Delete"}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
