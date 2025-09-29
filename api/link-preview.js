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
// /api/link-preview?url=...
import * as cheerio from "cheerio"; // npm i cheerio
export default async function handler(req, res) {
  const url = req.query.url;
  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8,nl;q=0.7",
    },
  });

  const html = await r.text();
  const $ = cheerio.load(html);

  // OG & Twitter fallbacks
  const get = (sel, attr) => ($(sel).attr(attr) || "").trim();
  const title =
    get('meta[property="og:title"]', "content") ||
    $("title").text().trim() ||
    $("h1").first().text().trim();

  const description =
    get('meta[property="og:description"]', "content") ||
    get('meta[name="description"]', "content") ||
    $("p").first().text().trim();

  let image =
    get('meta[property="og:image:secure_url"]', "content") ||
    get('meta[property="og:image"]', "content") ||
    get('meta[name="twitter:image"]', "content") ||
    $('img[src]').first().attr("src");

  // Absolutiseer relatieve paden
  try { image = new URL(image, url).href; } catch {}

  const siteName =
    get('meta[property="og:site_name"]', "content") ||
    new URL(url).hostname;

  res.json({ title, description, image, siteName });
}
