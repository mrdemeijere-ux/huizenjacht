// /api/geocode.js  (Vercel serverless function)
export default async function handler(req, res) {
  try {
    const {
      url,
      address = "",
      city = "",
      postalCode = "",
      country = "France",
      debug = "0",
    } = req.query || {};

    const tried = [];
    let html = "";
    let urlHints = {};

    // ---------- 1) Verzamel hints uit de listing-URL ----------
    if (url) {
      try {
        const r = await fetch(url, {
          headers: {
            "User-Agent": "Huizenjacht/1.0 (+support@example.com)",
            "Accept-Language": "nl-NL,nl;q=0.9,fr;q=0.8,en;q=0.7",
          },
        });
        html = await r.text();

        // (a) JSON-LD: "geo": {"latitude": "...", "longitude": "..."}
        const latJson = html.match(/"latitude"\s*:\s*"(-?\d+(?:\.\d+)?)"/i);
        const lonJson = html.match(/"longitude"\s*:\s*"(-?\d+(?:\.\d+)?)"/i);
        if (latJson && lonJson) {
          const lat = Number(latJson[1]);
          const lng = Number(lonJson[1]);
          if (isFinite(lat) && isFinite(lng)) {
            return res
              .status(200)
              .json({ lat, lng, source: "listing-geo", displayName: "from JSON-LD geo", q: null });
          }
        }

        // (b) JSON-LD: addressLocality / postalCode
        const cityJson = html.match(/"addressLocality"\s*:\s*"([^"]+)"/i)?.[1];
        const postJson = html.match(/"postalCode"\s*:\s*"(\d{4,6})"/i)?.[1];

        // (c) Tekstpatroon: “Brusque (12360)”
        const mCombo = html.match(/([A-ZÉÈÊÂÀÇÙa-zÀ-ÿ' -]+)\s*\((\d{4,6})\)/);

        urlHints = {
          city: cityJson || (mCombo ? mCombo[1] : undefined),
          postalCode: postJson || (mCombo ? mCombo[2] : undefined),
        };

        // (d) URL-pad: neem bruikbare segmenten als fallback (bv. /brusque/...)
        try {
          const u = new URL(url);
          const segs = u.pathname.split("/").filter(Boolean);
          // heuristiek: pak laatste seg die op plaatsnaam lijkt
          const locSeg = [...segs]
            .reverse()
            .find(
              (s) =>
                /^[a-zA-ZÀ-ÿ-]+$/.test(s) &&
                !s.endsWith(".htm") &&
                !["properties", "property", "nl", "fr", "en", "es"].includes(s.toLowerCase())
            );
          if (!urlHints.city && locSeg) {
            urlHints.city = locSeg.replace(/-/g, " ");
          }
        } catch {}
      } catch {
        // negeren; we blijven wel geocoden met wat we hebben
      }
    }

    // ---------- 2) Stel kandidaten samen ----------
    const cand = [];

    // Volledig adres als 1e poging
    if (address || city || postalCode) {
      cand.push([address, postalCode, city, country].filter(Boolean).join(" ").trim());
    }

    // URL-hints (stad + postcode + land)
    if (urlHints.city || urlHints.postalCode) {
      cand.push([urlHints.city, urlHints.postalCode, country].filter(Boolean).join(" ").trim());
    }

    // Alleen stad + land
    if (city) cand.push([city, country].filter(Boolean).join(" ").trim());
    if (urlHints.city) cand.push([urlHints.city, country].filter(Boolean).join(" ").trim());

    // Alleen postcode + land
    if (postalCode) cand.push([postalCode, country].filter(Boolean).join(" ").trim());
    if (urlHints.postalCode) cand.push([urlHints.postalCode, country].filter(Boolean).join(" ").trim());

    // Laatste redmiddel: alleen adres + land
    if (address && !(city || postalCode)) cand.push([address, country].filter(Boolean).join(" ").trim());

    // Filter/unique/zinvolle lengte
    const seen = new Set();
    const candidates = cand
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s && s.length >= 3 && !seen.has(s) && seen.add(s));

    // Als er helemaal niets is, geef fout
    if (!candidates.length) {
      return res.status(400).json({ error: "no_query", note: "Geen bruikbare zoekterm", urlHints, candidates });
    }

    // ---------- 3) Nominatim proberen, sequentieel ----------
    for (const q of candidates) {
      const u = new URL("https://nominatim.openstreetmap.org/search");
      u.searchParams.set("q", q);
      u.searchParams.set("format", "jsonv2");
      u.searchParams.set("limit", "1");

      tried.push(q);

      const geo = await fetch(u, {
        headers: { "User-Agent": "Huizenjacht/1.0 (+support@example.com)" },
      });
      if (!geo.ok) continue;

      const data = await geo.json().catch(() => null);
      if (Array.isArray(data) && data[0] && data[0].lat && data[0].lon) {
        const { lat, lon, display_name, boundingbox } = data[0];
        res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=86400");
        return res.status(200).json({
          lat: Number(lat),
          lng: Number(lon),
          displayName: display_name,
          bbox: boundingbox,
          q,
          source: "nominatim",
          ...(debug === "1" ? { tried, urlHints } : {}),
        });
      }
    }

    // ---------- 4) Niets gevonden ----------
    return res.status(404).json({
      error: "not_found",
      message: "Geen resultaten van Nominatim",
      ...(debug === "1" ? { tried, urlHints, candidates } : {}),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
