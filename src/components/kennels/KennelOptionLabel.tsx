export type KennelOptionData = {
  id: string;
  shortName: string;
  fullName: string;
  region?: string;
  regionName?: string;
};

interface KennelOptionLabelProps {
  kennel: KennelOptionData;
  showRegion?: boolean;
}

export function KennelOptionLabel({
  kennel,
  showRegion = true,
}: KennelOptionLabelProps) {
  const displayRegion = kennel.regionName ?? kennel.region;
  return (
    <>
      <span className="flex-1 truncate">
        <span className="font-medium">{kennel.shortName}</span>
        <span className="ml-1.5 text-muted-foreground">
          — {kennel.fullName}
        </span>
      </span>
      {showRegion && displayRegion && (
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {displayRegion}
        </span>
      )}
    </>
  );
}
