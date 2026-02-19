export type KennelOptionData = {
  id: string;
  shortName: string;
  fullName: string;
  region: string;
};

interface KennelOptionLabelProps {
  kennel: KennelOptionData;
  showRegion?: boolean;
}

export function KennelOptionLabel({
  kennel,
  showRegion = true,
}: KennelOptionLabelProps) {
  return (
    <>
      <span className="flex-1 truncate">
        <span className="font-medium">{kennel.shortName}</span>
        <span className="ml-1.5 text-muted-foreground">
          — {kennel.fullName}
        </span>
      </span>
      {showRegion && (
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {kennel.region}
        </span>
      )}
    </>
  );
}
