// /api/link-preview.js - Vercel Serverless Function
export default async function handler(req, res) {
  // --- CORS (nodig voor Vite dev op 5173 of andere origins) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const src = req.query.url || req.query.u;
    if (!src) return res.status(400).json({ error: "Missing url param ?url=" });

    const u = new URL(src);
    if (!/^https?:$/.test(u.protocol)) {
      return res.status(400).json({ error: "Only http(s) allowed" });
    }

    // Serverseitig fetchen (geen CORS-issues)
    const r = await fetch(src, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; HuizenjachtPreview/1.0; +https://huizenjacht.vercel.app/)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    const contentType = r.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return res.status(415).json({ error: "URL is not HTML" });
    }

    const html = await r.text();

    // helpers
    const pick = (re) => {
      const m = html.match(re);
      return m ? m[1].trim() : "";
    };
    const meta = (name) =>
      pick(
        new RegExp(
          `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
          "i"
        )
      );

    // meta extraction
    const title =
      meta("og:title") ||
      meta("twitter:title") ||
      pick(/<title[^>]*>([^<]+)<\/title>/i);
    const description =
      meta("og:description") ||
      meta("twitter:description") ||
      meta("description");

    let image = meta("og:image") || meta("twitter:image");
    if (image) {
      try {
        image = new URL(image, u.origin).href; // relative → absolute
      } catch {}
    }

    const siteName = meta("og:site_name") || u.hostname.replace(/^www\./, "");
    const favicon = `${u.origin}/favicon.ico`;

    // Cache voor performance
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=86400, stale-while-revalidate=86400"
    );

    return res.status(200).json({
      title,
      description,
      image,
      siteName,
      favicon,
      url: src,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
