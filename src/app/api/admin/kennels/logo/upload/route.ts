import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";

/**
 * Client-upload token endpoint for kennel logos (#1414). The browser calls
 * `upload()` from `@vercel/blob/client` against this route, which mints a
 * scoped, short-lived upload token — the file streams directly to Vercel Blob,
 * never through this function. Admin-gated inside `onBeforeGenerateToken`.
 *
 * Requires the `BLOB_READ_WRITE_TOKEN` env var (Vercel Blob store). Until that
 * is provisioned the route returns 500 from `handleUpload`; the KennelForm
 * degrades gracefully — admins can still paste an https Logo URL by hand.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const admin = await getAdminUser();
        if (!admin) throw new Error("Not authorized");
        return {
          // No SVG — next/image can't optimize it (dangerouslyAllowSVG is off)
          // and it carries an XSS surface. Raster only, 2 MB cap.
          allowedContentTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
          maximumSizeInBytes: 2 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
      // The uploaded https URL is returned to the client, which writes it into
      // the logoUrl field; persistence happens via the normal kennel mutation.
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
