import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface KennelCardProps {
  kennel: {
    slug: string;
    shortName: string;
    fullName: string;
    region: string;
    _count: { members: number };
  };
}

export function KennelCard({ kennel }: KennelCardProps) {
  return (
    <Link href={`/kennels/${kennel.slug}`}>
      <Card className="transition-colors hover:border-primary/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">{kennel.shortName}</CardTitle>
          <p className="text-sm text-muted-foreground">{kennel.fullName}</p>
        </CardHeader>
        <CardContent className="flex items-center gap-2">
          <Badge variant="secondary">{kennel.region}</Badge>
          <span className="text-xs text-muted-foreground">
            {kennel._count.members}{" "}
            {kennel._count.members === 1 ? "subscriber" : "subscribers"}
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}
