import { env } from "@/lib/env";

/**
 * A page's logo (or header photo) in the public `page-images` bucket, one
 * folder per page. A full URL is used as it is, as in the app.
 */
export function pageImageUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${env.supabaseUrl}/storage/v1/object/public/page-images/${path.split("/").map(encodeURIComponent).join("/")}`;
}
