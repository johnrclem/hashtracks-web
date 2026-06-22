import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";

/**
 * Client-upload token endpoint for user profile photos (#109). The browser
 * calls `upload()` from `@vercel/blob/client` against this route, which mints a
 * scoped, short-lived upload token — the file streams directly to Vercel Blob,
 * never through this function. Gated to any signed-in user inside
 * `onBeforeGenerateToken` (mirrors the kennel-logo route, which is admin-gated).
 *
 * Requires the `BLOB_READ_WRITE_TOKEN` env var (Vercel Blob store). Until that
 * is provisioned the route returns an error from `handleUpload`; the profile
 * form degrades gracefully — the rest of the form still saves.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const user = await getOrCreateUser();
        if (!user) throw new Error("Not authorized");
        return {
          // No SVG — next/image can't optimize it (dangerouslyAllowSVG is off)
          // and it carries an XSS surface. Raster only, 2 MB cap.
          allowedContentTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
          maximumSizeInBytes: 2 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
      // The uploaded https URL is returned to the client, which writes it into
      // the avatarUrl field; persistence happens via the updateProfile action.
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 400 },
    );
  }
}
