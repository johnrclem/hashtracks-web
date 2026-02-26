"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteKennel, toggleKennelVisibility } from "@/app/admin/kennels/actions";
import { MoreHorizontal, Eye, EyeOff } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KennelForm, type RegionOption } from "./KennelForm";
import { toast } from "sonner";

type Kennel = {
  id: string;
  shortName: string;
  fullName: string;
  region: string;
  regionId: string | null;
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
  isHidden: boolean;
};

interface KennelTableProps {
  kennels: Kennel[];
  regions: RegionOption[];
}

export function KennelTable({ kennels, regions }: Readonly<KennelTableProps>) {
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState("all");

  const regionNames = useMemo(() => {
    const set = new Set(kennels.map((k) => k.region));
    return [...set].sort((a, b) => a.localeCompare(b));
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
            {regionNames.map((r) => (
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
                <KennelRow key={kennel.id} kennel={kennel} regions={regions} />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function KennelRow({ kennel, regions }: { kennel: Kennel; regions: RegionOption[] }) {
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

  function handleToggleVisibility() {
    startTransition(async () => {
      const result = await toggleKennelVisibility(kennel.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(result.isHidden ? "Kennel hidden" : "Kennel visible");
      }
      router.refresh();
    });
  }

  return (
    <TableRow className={kennel.isHidden ? "opacity-50" : undefined}>
      <TableCell className="font-medium sticky left-0 bg-background z-10">
        <span className="flex items-center gap-1.5">
          {kennel.shortName}
          {kennel.isHidden && (
            <Badge variant="secondary" className="text-[10px] px-1 py-0">Hidden</Badge>
          )}
        </span>
      </TableCell>
      <TableCell className="hidden sm:table-cell">{kennel.fullName}</TableCell>
      <TableCell>
        <Badge variant="outline">{kennel.region}</Badge>
      </TableCell>
      <TableCell className="hidden sm:table-cell text-center">{kennel._count.aliases}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <KennelForm
            kennel={kennel}
            regions={regions}
            trigger={<Button size="sm" variant="outline">Edit</Button>}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" disabled={isPending}>
                <MoreHorizontal className="size-4" />
                <span className="sr-only">More actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleToggleVisibility} disabled={isPending}>
                {kennel.isHidden ? (
                  <><Eye className="mr-2 size-4" /> Show Kennel</>
                ) : (
                  <><EyeOff className="mr-2 size-4" /> Hide Kennel</>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setShowDelete(true)}
                disabled={isPending}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
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
