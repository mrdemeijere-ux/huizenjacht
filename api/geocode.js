// /api/geocode.js
let CACHE = new Map(); // naive in-memory cache (Vercel lambda: OK voor korte tijd)

export default async function handler(req, res) {
  try {
    const q = (req.query.q || "").toString().trim();
    if (!q) return res.status(400).json({ error: "Missing q" });

    if (CACHE.has(q)) {
      return res.status(200).json(CACHE.get(q));
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, {
      headers: {
        // Nominatim etiquette: geef een User-Agent + contact
        "User-Agent": "Huizenjacht/1.0 (mailto:you@example.com)",
        "Accept-Language": "nl,en,fr;q=0.8",
      },
    });

    if (!r.ok) {
      return res.status(502).json({ error: `Upstream ${r.status}` });
    }

    const data = await r.json();
    const best = data && data[0];
    if (!best) {
      const fail = { ok: false };
      CACHE.set(q, fail);
      return res.status(200).json(fail);
    }

    const result = {
      ok: true,
      lat: Number(best.lat),
      lng: Number(best.lon),
      displayName: best.display_name,
    };
    CACHE.set(q, result);
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
