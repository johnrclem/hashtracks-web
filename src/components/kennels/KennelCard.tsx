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
          <CardTitle className="text-base leading-tight">
            {kennel.fullName}
          </CardTitle>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-sm font-medium text-muted-foreground">
              {kennel.shortName}
            </span>
            <Badge variant="secondary" className="text-xs">
              {kennel.region}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <span className="text-xs text-muted-foreground">
            {kennel._count.members}{" "}
            {kennel._count.members === 1 ? "subscriber" : "subscribers"}
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}
