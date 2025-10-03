// /api/geocode.js  (Vercel Node.js Serverless Function)
let CACHE = new Map();

const CONTACT = process.env.GEOCODE_CONTACT || "you@example.com"; // <-- zet echte e-mail
const BASE = "https://nominatim.openstreetmap.org/search";

function withTimeout(promise, ms = 6000) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Timeout")), ms)),
  ]);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const q = (req.query.q || "").toString().trim();
  if (!q) return res.status(400).json({ error: "Missing q" });

  // simpele in-memory cache
  if (CACHE.has(q)) {
    const hit = CACHE.get(q);
    // publieke cache via Vercel CDN: 1 dag, stale-while-revalidate 1 dag
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=86400");
    return res.status(200).json(hit);
  }

  // Nominatim parameters: FR bias + v2 output + 1 result
  const url = `${BASE}?format=jsonv2&limit=1&countrycodes=fr&q=${encodeURIComponent(q)}`;

  try {
    let r = await withTimeout(fetch(url, {
      headers: {
        "User-Agent": `Huizenjacht/1.0 (${CONTACT})`,
        "Accept-Language": "nl,en,fr;q=0.8",
        "Referer": req.headers.origin || "https://vercel.app",
      },
    }));

    // simpele 429 backoff
    if (r.status === 429) {
      await new Promise(r => setTimeout(r, 800));
      r = await withTimeout(fetch(url, {
        headers: {
          "User-Agent": `Huizenjacht/1.0 (${CONTACT})`,
          "Accept-Language": "nl,en,fr;q=0.8",
          "Referer": req.headers.origin || "https://vercel.app",
        },
      }));
    }

    if (!r.ok) {
      return res.status(502).json({ error: `Upstream ${r.status}` });
    }

    const data = await r.json();
    const best = Array.isArray(data) ? data[0] : null;

    // CDN cache headers (ook bij misses is nuttig)
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=86400");

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
      // optioneel: class/type van het resultaat kan handig zijn
      class: best.class,
      type: best.type,
    };

    CACHE.set(q, result);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
