import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { HARELINE_EVENTS_TAG } from "@/lib/cache-tags";
import { regionNameToSlug, regionSlug } from "@/lib/region";

/**
 * Revalidate every page that shows a kennel's status. A plain module, not a
 * server action, so server actions and cron routes can share it without it
 * being client-callable. Must run in a request context.
 *
 * `hareline: false` leaves the hareline and its cached event list alone, for
 * writes that can't change it: a Half-Mind check, link, add or unlink.
 */
export async function revalidateKennel(kennelId: string, opts: { hareline?: boolean } = {}) {
  const kennel = await prisma.kennel.findUnique({
    where: { id: kennelId },
    select: { slug: true, region: true },
  });
  revalidatePath("/admin/kennels");
  revalidatePath("/admin/sources");
  revalidatePath("/kennels");
  if (kennel) {
    revalidatePath(`/kennels/${kennel.slug}`);
    if (kennel.region) revalidatePath(`/kennels/region/${regionNameToSlug(kennel.region) ?? regionSlug(kennel.region)}`);
  }
  if (opts.hareline === false) return;
  revalidatePath("/hareline");
  // Stopping hides a kennel's schedule-only runs from the cached hareline list.
  revalidateTag(HARELINE_EVENTS_TAG, { expire: 0 });
}
