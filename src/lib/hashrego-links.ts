import { prisma } from "@/lib/db";

export { HASHREGO_TAG_LINK_REFUSAL } from "@/lib/hashrego-link-refusal";

/** Whether a source is the HASHREGO source. */
export async function isHashRegoSource(sourceId: string): Promise<boolean> {
  const source = await prisma.source.findUnique({ where: { id: sourceId }, select: { type: true } });
  return source?.type === "HASHREGO";
}
