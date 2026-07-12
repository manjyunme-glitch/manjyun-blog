import { getSiteSettings, listPosts } from "@/lib/db/queries";
import { buildRssFeed } from "@/lib/seo/feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const settings = getSiteSettings();
  const posts = listPosts({
    type: "post",
    status: "published",
    limit: 50,
    includeTags: false
  });
  return new Response(buildRssFeed({ settings, posts }), {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Content-Type": "application/rss+xml; charset=utf-8"
    }
  });
}
