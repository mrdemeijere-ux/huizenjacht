// /api/geocode.js — FR geocoding met disambiguation + city-sanitizer

function norm(s = "") {
  return s
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function adminName(addr) {
  return addr?.city || addr?.town || addr?.village || addr?.municipality || addr?.hamlet || "";
}

// Haal alleen de plaatsnaam uit titels als “Vente maison à Montferrand …”
function sanitizeCity(raw = "") {
  let t = raw.replace(/\s+/g, " ").trim();

  // Als “... à Ville ...” voorkomt, pak wat er NA de laatste “ à ” komt
  const mA = t.match(/(?:^|[^A-Za-zÀ-ÿ])(à|a)\s+([A-Za-zÀ-ÿ' -]+)(?:\s*[\(|\\|—-]|$)/i);
  if (mA && mA[2]) {
    t = mA[2].trim();
  }

  // Verwijder veelvoorkomende marketing-prefixes indien die aan het begin staan
  t = t.replace(/^(vente|location|achat|maison|appartement|terrain|villa|local|bureaux|immeuble|studio)\b.*$/i, "").trim();

  // Laatste schoonmaak: alleen letters/spaties/’/-
  const mOnly = t.match(/[A-Za-zÀ-ÿ' -]+/);
  t = mOnly ? mOnly[0].trim() : t;

  return t;
}

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Huizenjacht/1.0 (+support@example.com)",
      "Accept-Language": "nl-NL,nl;q=0.9,fr;q=0.8,en;q=0.7",
    },
  });
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  return await r.text();
}

function extractHintsFromHtml(html) {
  // 1) JSON-LD geo → direct klaar
  const lat = html.match(/"latitude"\s*:\s*"(-?\d+(?:\.\d+)?)"/i)?.[1];
  const lon = html.match(/"longitude"\s*:\s*"(-?\d+(?:\.\d+)?)"/i)?.[1];
  if (lat && lon) {
    const la = Number(lat), lo = Number(lon);
    if (isFinite(la) && isFinite(lo)) return { lat: la, lng: lo, direct: true };
  }

  const hints = {};

  // 2) JSON-LD address*
  const pc = html.match(/"postalCode"\s*:\s*"(\d{4,6})"/i)?.[1];
  let city = html.match(/"addressLocality"\s*:\s*"([^"]+)"/i)?.[1];
  const state = html.match(/"addressRegion"\s*:\s*"([^"]+)"/i)?.[1];
  const county = html.match(/"addressCounty"\s*:\s*"([^"]+)"/i)?.[1];

  if (city) city = sanitizeCity(city);
  if (pc) hints.postalCode = pc;
  if (city) hints.city = city;
  if (state) hints.state = state;
  if (county) hints.county = county;

  // 3) Tekstpatroon “Ville (12345)”
  if (!hints.postalCode || !hints.city) {
    const m = html.match(/([A-ZÉÈÊÂÀÇÙa-zÀ-ÿ' -]+)\s*\((\d{4,6})\)/);
    if (m) {
      if (!hints.city) hints.city = sanitizeCity(m[1]);
      if (!hints.postalCode) hints.postalCode = m[2];
    }
  }

  // 4) <title>…</title> fallback (IAD heeft vaak “Vente maison à Montferrand (11320) …”)
  if (!hints.city) {
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
    if (title) {
      const tCity = title.match(/([A-ZÉÈÊÂÀÇÙa-zÀ-ÿ' -]+)\s*\((\d{4,6})\)/) || title.match(/à\s+([A-ZÉÈÊÂÀÇÙa-zÀ-ÿ' -]+)/i);
      if (tCity) hints.city = sanitizeCity(tCity[1] || tCity[0]);
      const tPc = title.match(/\((\d{4,6})\)/);
      if (!hints.postalCode && tPc) hints.postalCode = tPc[1];
    }
  }

  // 5) Breadcrumbs op regio/department (bijv. Occitanie / Aude)
  const allCrumbs = Array.from(html.matchAll(/>([A-ZÉÈÊÂÀÇÙa-zÀ-ÿ' -]+)<\/a>/g)).map((x) => x[1]);
  if (allCrumbs.some((s) => /\bOccitanie\b/i.test(s))) hints.state = "Occitanie";
  if (allCrumbs.some((s) => /\bAude\b/i.test(s))) hints.county = "Aude";

  return hints;
}

function cityFromPath(u) {
  try {
    const segs = new URL(u).pathname.split("/").filter(Boolean);
    const cand = [...segs].reverse().find((s) => /[a-zA-ZÀ-ÿ]/.test(s) && !s.endsWith(".htm"));
    if (!cand) return "";
    const name = cand.split("-").filter((tok) => /[a-zA-ZÀ-ÿ]/.test(tok)).join(" ");
    return sanitizeCity(name);
  } catch {
    return "";
  }
}

async function nominatimStructured({ city, postalCode, state, county }) {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  if (city) u.searchParams.set("city", city);
  if (postalCode) u.searchParams.set("postalcode", postalCode);
  if (state) u.searchParams.set("state", state);
  if (county) u.searchParams.set("county", county);
  u.searchParams.set("country", "France");
  u.searchParams.set("countrycodes", "fr");
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("limit", "5");
  u.searchParams.set("addressdetails", "1");
  const r = await fetch(u, { headers: { "User-Agent": "Huizenjacht/1.0 (+support@example.com)" } });
  if (!r.ok) return [];
  return (await r.json()) || [];
}

async function nominatimText(q) {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("q", q);
  u.searchParams.set("countrycodes", "fr");
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("limit", "5");
  u.searchParams.set("addressdetails", "1");
  const r = await fetch(u, { headers: { "User-Agent": "Huizenjacht/1.0 (+support@example.com)" } });
  if (!r.ok) return [];
  return (await r.json()) || [];
}

function chooseBest(results, { postalCode, city, state, county }) {
  if (!Array.isArray(results) || results.length === 0) return null;

  // 1) exact postcode
  if (postalCode) {
    const e = results.find((x) => x?.address?.postcode === postalCode);
    if (e) return e;
  }
  // 2) departement
  if (county) {
    const nc = norm(county);
    const e = results.find((x) => norm(x?.address?.county || "") === nc);
    if (e) return e;
  }
  // 3) regio
  if (state) {
    const ns = norm(state);
    const e = results.find((x) => norm(x?.address?.state || "") === ns);
    if (e) return e;
  }
  // 4) plaatsnaam
  if (city) {
    const n = norm(city);
    const e = results.find((x) => norm(adminName(x.address)) === n);
    if (e) return e;
  }
  return results[0];
}

export default async function handler(req, res) {
  try {
    const { url, address = "", city = "", postalCode = "", country = "France", debug = "0" } = req.query || {};
    let hints = {};
    const tried = [];
    let htmlCity = "";

    // Scrape listing
    if (url) {
      try {
        const html = await fetchHtml(url);
        const h = extractHintsFromHtml(html);
        if (h?.direct) {
          return res.status(200).json({ lat: h.lat, lng: h.lng, source: "listing-geo" });
        }
        hints = h;
        if (!hints.city) {
          htmlCity = cityFromPath(url);
          if (htmlCity) hints.city = htmlCity;
        }
      } catch { /* ignore scraping errors */ }
    }

    // Combineer input + hints (en SANITIZE!)
    const want = {
      city: sanitizeCity(city || hints.city || ""),
      postalCode: (postalCode || hints.postalCode || "").trim(),
      state: (hints.state || "").trim(),
      county: (hints.county || "").trim(),
    };

    // 1) Structured (rijk)
    const s1 = await nominatimStructured(want);
    tried.push({ type: "structured", want, got: s1.length });
    let best = chooseBest(s1, want);
    if (best) {
      return res.status(200).json({
        lat: Number(best.lat), lng: Number(best.lon),
        displayName: best.display_name, source: "nominatim-structured",
        ...(debug === "1" ? { tried, hints } : {}),
      });
    }

    // 2) Structured (lite)
    const s2 = await nominatimStructured({ city: want.city, postalCode: want.postalCode });
    tried.push({ type: "structured-lite", want: { city: want.city, postalCode: want.postalCode }, got: s2.length });
    best = chooseBest(s2, want);
    if (best) {
      return res.status(200).json({
        lat: Number(best.lat), lng: Number(best.lon),
        displayName: best.display_name, source: "nominatim-structured-lite",
        ...(debug === "1" ? { tried, hints } : {}),
      });
    }

    // 3) Free-text kandidaten (ook “alleen postcode”!)
    const candidates = [];
    if (want.postalCode || want.city || want.county || want.state) {
      candidates.push([want.city, want.postalCode, want.county, want.state, country].filter(Boolean).join(" "));
    }
    if (address) {
      candidates.push([address, want.city, want.county, country].filter(Boolean).join(" "));
    }
    // heel belangrijk: pure postcode fallback
    if (want.postalCode) {
      candidates.push([want.postalCode, country].filter(Boolean).join(" "));
    }

    const seen = new Set();
    const uniq = candidates.map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s && !seen.has(s) && seen.add(s));

    const triedText = [];
    for (const q of uniq) {
      const r = await nominatimText(q);
      triedText.push({ q, got: r.length });
      best = chooseBest(r, want);
      if (best) {
        return res.status(200).json({
          lat: Number(best.lat), lng: Number(best.lon),
          displayName: best.display_name, source: "nominatim-text",
          ...(debug === "1" ? { tried, triedText, hints, want } : {}),
        });
      }
    }

    return res.status(404).json({
      error: "not_found", message: "Geen resultaten",
      ...(debug === "1" ? { tried, hints, want, triedText } : {}),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
