"use client";

import { useState, useTransition } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { deleteRegion } from "@/app/admin/regions/actions";
import { RegionFormDialog } from "./RegionFormDialog";
import { RegionMergeDialog } from "./RegionMergeDialog";
import { useRouter } from "next/navigation";

export interface RegionRow {
  id: string;
  name: string;
  slug: string;
  country: string;
  timezone: string;
  abbrev: string;
  colorClasses: string;
  pinColor: string;
  centroidLat: number | null;
  centroidLng: number | null;
  parentId: string | null;
  parentName: string | null;
  kennels: { id: string; shortName: string; slug: string }[];
  childCount: number;
}

export function RegionTable({ regions }: { regions: RegionRow[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showCreate, setShowCreate] = useState(false);
  const [editRegion, setEditRegion] = useState<RegionRow | null>(null);
  const [showMerge, setShowMerge] = useState(false);
  const [countryFilter, setCountryFilter] = useState("");
  const router = useRouter();

  const countries = Array.from(new Set(regions.map((r) => r.country))).sort();

  const filtered = countryFilter
    ? regions.filter((r) => r.country === countryFilter)
    : regions;

  function handleDelete(regionId: string, name: string, kennelCount: number) {
    if (kennelCount > 0) {
      toast.error(`Cannot delete "${name}" — ${kennelCount} kennel(s) assigned`);
      return;
    }
    if (!confirm(`Delete region "${name}"?`)) return;
    startTransition(async () => {
      const result = await deleteRegion(regionId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`Deleted "${name}"`);
        router.refresh();
      }
    });
  }

  const totalKennels = regions.reduce((sum, r) => sum + r.kennels.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">
            {regions.length} Regions
          </h2>
          <span className="text-sm text-muted-foreground">
            {totalKennels} kennels
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Country filter */}
          {countries.length > 1 && (
            <div className="flex gap-1">
              <button
                onClick={() => setCountryFilter("")}
                className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  !countryFilter
                    ? "bg-primary text-primary-foreground"
                    : "border text-muted-foreground hover:text-foreground"
                }`}
              >
                All
              </button>
              {countries.map((c) => (
                <button
                  key={c}
                  onClick={() => setCountryFilter(countryFilter === c ? "" : c)}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                    countryFilter === c
                      ? "bg-primary text-primary-foreground"
                      : "border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          <Button variant="outline" size="sm" onClick={() => setShowMerge(true)}>
            Merge Regions
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            Add Region
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Region</TableHead>
              <TableHead>Abbrev</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Timezone</TableHead>
              <TableHead className="text-right">Kennels</TableHead>
              <TableHead>Color</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((region) => (
              <>
                <TableRow
                  key={region.id}
                  className="cursor-pointer"
                  onClick={() =>
                    setExpandedId(expandedId === region.id ? null : region.id)
                  }
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{region.name}</span>
                      {region.parentName && (
                        <span className="text-xs text-muted-foreground">
                          (in {region.parentName})
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={region.colorClasses}>
                      {region.abbrev}
                    </Badge>
                  </TableCell>
                  <TableCell>{region.country}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {region.timezone}
                  </TableCell>
                  <TableCell className="text-right">
                    {region.kennels.length}
                  </TableCell>
                  <TableCell>
                    <div
                      className="h-4 w-4 rounded-full border"
                      style={{ backgroundColor: region.pinColor }}
                      title={region.pinColor}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditRegion(region);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-destructive"
                        disabled={region.kennels.length > 0 || isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(region.id, region.name, region.kennels.length);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>

                {expandedId === region.id && (
                  <TableRow key={`${region.id}-detail`}>
                    <TableCell colSpan={7} className="bg-muted/50 px-8 py-3">
                      {region.kennels.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No kennels assigned to this region.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {region.kennels.map((k) => (
                            <Badge key={k.id} variant="outline">
                              {k.shortName}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {region.centroidLat != null && region.centroidLng != null && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Centroid: {region.centroidLat.toFixed(2)}, {region.centroidLng.toFixed(2)}
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}

            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No regions found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create dialog */}
      {showCreate && (
        <RegionFormDialog
          regions={regions}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* Edit dialog */}
      {editRegion && (
        <RegionFormDialog
          region={editRegion}
          regions={regions}
          onClose={() => setEditRegion(null)}
        />
      )}

      {/* Merge dialog */}
      {showMerge && (
        <RegionMergeDialog
          regions={regions}
          onClose={() => setShowMerge(false)}
        />
      )}
    </div>
  );
}
