"use client";

import { useMemo, useState, useTransition } from "react";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState("all");

  const regions = useMemo(() => {
    const set = new Set(kennels.map((k) => k.region));
    return [...set].sort();
  }, [kennels]);

  const filtered = useMemo(() => {
    let result = kennels;
    if (regionFilter !== "all") {
      result = result.filter((k) => k.region === regionFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (k) =>
          k.shortName.toLowerCase().includes(q) ||
          k.fullName.toLowerCase().includes(q) ||
          k.aliases.some((a) => a.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [kennels, regionFilter, search]);

  if (kennels.length === 0) {
    return <p className="text-sm text-muted-foreground">No kennels yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search kennels..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-full sm:w-64 text-xs"
        />
        <Select value={regionFilter} onValueChange={setRegionFilter}>
          <SelectTrigger className="h-8 w-full sm:w-[200px] text-xs">
            <SelectValue placeholder="All regions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All regions</SelectItem>
            {regions.map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(search || regionFilter !== "all") && (
          <span className="text-xs text-muted-foreground">
            {filtered.length} of {kennels.length}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-background z-10">Short Name</TableHead>
              <TableHead className="hidden sm:table-cell">Full Name</TableHead>
              <TableHead>Region</TableHead>
              <TableHead className="hidden sm:table-cell text-center">Aliases</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                  No kennels match your search.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((kennel) => (
                <KennelRow key={kennel.id} kennel={kennel} />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function KennelRow({ kennel }: { kennel: Kennel }) {
  const [isPending, startTransition] = useTransition();
  const [showDelete, setShowDelete] = useState(false);
  const router = useRouter();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteKennel(kennel.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Kennel deleted");
      }
      setShowDelete(false);
      router.refresh();
    });
  }

  return (
    <TableRow>
      <TableCell className="font-medium sticky left-0 bg-background z-10">{kennel.shortName}</TableCell>
      <TableCell className="hidden sm:table-cell">{kennel.fullName}</TableCell>
      <TableCell>
        <Badge variant="outline">{kennel.region}</Badge>
      </TableCell>
      <TableCell className="hidden sm:table-cell text-center">{kennel._count.aliases}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <KennelForm
            kennel={kennel}
            trigger={<Button size="sm" variant="outline">Edit</Button>}
          />
          <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={isPending}
              onClick={() => setShowDelete(true)}
            >
              {isPending ? "..." : "Delete"}
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Kennel?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete &ldquo;{kennel.shortName}&rdquo; and
                  cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={isPending}
                >
                  {isPending ? "Deleting..." : "Delete Kennel"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TableCell>
    </TableRow>
  );
}
