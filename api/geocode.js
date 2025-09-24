export default async function handler(req, res) {
  try {
    const { url, address = "", city = "", postalCode = "", country = "France" } = req.query || {};
    // 1) Bouw een zoekstring
    let q = [address, postalCode, city, country].filter(Boolean).join(" ").trim();

    // 2) Als geen query en er is een listing-URL (bijv. Green-Acres): haal plaats+postcode uit de HTML
    if (!q && url) {
      const r = await fetch(url, { headers: { "User-Agent": "Huizenjacht/1.0 (+contact@example.com)" } });
      const html = await r.text();

      // patronen op de Green-Acres pagina, bv. “Brusque (12360)”
      const m = html.match(/([A-ZÉÈÊÂÀÇÙa-zÀ-ÿ' -]+)\s*\((\d{5})\)/);
      if (m) q = `${m[1]} ${m[2]} ${country}`;

      // fallback: JSON-LD addressLocality/postalCode
      if (!q) {
        const mCity = html.match(/"addressLocality"\s*:\s*"([^"]+)"/);
        const mPost = html.match(/"postalCode"\s*:\s*"(\d{5})"/);
        if (mCity || mPost) q = `${mCity?.[1] || ""} ${mPost?.[1] || ""} ${country}`.trim();
      }
    }

    if (!q) return res.status(400).json({ error: "no_query" });

    // 3) Nominatim-call (eerste hit). Respecteer beleid: User-Agent + limiet.
    const u = new URL("https://nominatim.openstreetmap.org/search");
    u.searchParams.set("q", q);
    u.searchParams.set("format", "jsonv2");
    u.searchParams.set("limit", "1");

    const geo = await fetch(u, {
      headers: { "User-Agent": "Huizenjacht/1.0 (+contact@example.com)" },
    });
    const data = await geo.json();

    if (!Array.isArray(data) || !data[0]) return res.status(404).json({ error: "not_found", q });

    const { lat, lon, display_name, boundingbox } = data[0];
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=86400");
    return res.status(200).json({
      lat: Number(lat),
      lng: Number(lon),
      displayName: display_name,
      bbox: boundingbox,
      q,
      source: "nominatim",
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
