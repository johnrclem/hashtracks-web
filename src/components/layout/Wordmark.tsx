import Link from "next/link";
import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("group inline-flex items-baseline", className)}>
      <span className="text-xl font-extrabold tracking-tight">
        Hash
        <span className="relative">
          Tracks
          <span className="absolute -bottom-0.5 left-0 right-0 h-[3px] rounded-full bg-orange-400/60 transition-colors group-hover:bg-orange-400" />
        </span>
      </span>
    </Link>
  );
}
