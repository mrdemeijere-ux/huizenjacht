// api/link-preview.js — eenvoudige metadata fetcher (serverless)
export const config = { runtime: "edge" };
function json(data, init = 200) { return new Response(JSON.stringify(data, null, 2), { status: typeof init === "number" ? init : 200, headers: { "content-type": "application/json; charset=utf-8" }, }); }
export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const target = searchParams.get("url");
    if (!target) return json({ error: "missing_url" }, 400);
    const res = await fetch(target, { headers: { "User-Agent": "Mozilla/5.0 HuizenjachtBot" } });
    const html = await res.text();
    const title = (html.match(/<title>(.*?)<\/title>/i) || [])[1] || "";
    const ogTitle = (html.match(/property=["']og:title["'][^>]*content=["']([^"']+)/i) || [])[1];
    const ogDesc = (html.match(/property=["']og:description["'][^>]*content=["']([^"']+)/i) || [])[1];
    const ogImage = (html.match(/property=["']og:image["'][^>]*content=["']([^"']+)/i) || [])[1];
    const siteName = (html.match(/property=["']og:site_name["'][^>]*content=["']([^"']+)/i) || [])[1];
    return json({ title: ogTitle || title || "", description: ogDesc || "", image: ogImage || "", siteName: siteName || "" });
  } catch (e) { return json({ error: "preview_failed", message: String(e?.message || e) }, 500); }
}
