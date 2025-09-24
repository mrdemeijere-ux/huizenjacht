// /api/geocode.js — disambiguated FR geocoding for OSM
// Strategie:
// - Scrape listing-URL (optioneel) voor hints: postalCode, city, region/state, county
// - Gebruik Nominatim structured search (city, postalcode, state, country)
// - Filter resultaten op exacte postcode, anders op city/state/county, anders fallback
// - countrycodes=fr, addressdetails=1, limit=5
// - Optioneel ?debug=1 om candidates/tried te zien

function normalize(s = "") {
  return s
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // strip diacritics
}

function pickAdminName(addr) {
  // beste gok voor plaatsnaam in Nominatim-address object:
  return addr?.city || addr?.town || addr?.village || addr?.municipality || addr?.hamlet || "";
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
  const hints = {};

  // JSON-LD geo
  const latJson = html.match(/"latitude"\s*:\s*"(-?\d+(?:\.\d+)?)"/i)?.[1];
  const lonJson = html.match(/"longitude"\s*:\s*"(-?\d+(?:\.\d+)?)"/i)?.[1];
  if (latJson && lonJson) {
    const lat = Number(latJson);
    const lng = Number(lonJson);
    if (isFinite(lat) && isFinite(lng)) return { lat, lng, direct: true };
  }

  // JSON-LD address bits
  const postal = html.match(/"postalCode"\s*:\s*"(\d{4,6})"/i)?.[1];
  const city = html.match(/"addressLocality"\s*:\s*"([^"]+)"/i)?.[1];
  const state = html.match(/"addressRegion"\s*:\s*"([^"]+)"/i)?.[1]; // bv. Occitanie
  const county = html.match(/"addressCounty"\s*:\s*"([^"]+)"/i)?.[1]; // niet altijd aanwezig

  // Tekstpatroon: “Ville (12345)”
  if (!postal || !city) {
    const mCombo = html.match(/([A-ZÉÈÊÂÀÇÙa-zÀ-ÿ' -]+)\s*\((\d{4,6})\)/);
    if (mCombo) {
      if (!city) hints.city = mCombo[1];
      if (!postal) hints.postalCode = mCombo[2];
    }
  }

  if (postal) hints.postalCode = postal;
  if (city) hints.city = city;
  if (state) hints.state = state;
  if (county) hints.county = county;

  // extra heuristiek voor sites als IAD: pak een plaatsnaam uit URL-pad als fallback
  const mTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  if (!hints.city && mTitle) {
    // “maison … – Montferrand (11320) – IAD” → haal segment vóór “(12345)”
    const mTitleCity = mTitle.match(/([A-ZÉÈÊÂÀÇÙa-zÀ-ÿ' -]+)\s*\(\d{4,6}\)/);
    if (mTitleCity) hints.city = mTitleCity[1];
  }

  return hints;
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

async function nominatimFreeText(q) {
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

  // 1) exact postcode-match
  if (postalCode) {
    const exact = results.find((x) => x?.address?.postcode === postalCode);
    if (exact) return exact;
  }

  // 2) city-naam (genormaliseerd)
  if (city) {
    const nc = normalize(city);
    const byCity = results.find((x) => normalize(pickAdminName(x.address)) === nc);
    if (byCity) return byCity;
  }

  // 3) state/region (Occitanie, etc.)
  if (state) {
    const ns = normalize(state);
    const byState = results.find((x) => normalize(x?.address?.state || "") === ns);
    if (byState) return byState;
  }

  // 4) county/département (Aude, etc.)
  if (county) {
    const nc = normalize(county);
    const byCounty = results.find((x) => normalize(x?.address?.county || "") === nc);
    if (byCounty) return byCounty;
  }

  // 5) fallback: eerste
  return results[0];
}

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
    let hints = {};
    let html = "";

    // 0) Listing scrapen voor hints
    if (url) {
      try {
        html = await fetchHtml(url);
        const parsed = extractHintsFromHtml(html);
        if (parsed?.direct) {
          // JSON-LD had al coördinaten → klaar
          return res.status(200).json({
            lat: parsed.lat,
            lng: parsed.lng,
            source: "listing-geo",
            displayName: "from JSON-LD geo",
            q: null,
          });
        }
        hints = parsed;
      } catch {
        // negeer scraping-fout
      }
    }

    // Combineer input + hints
    const want = {
      city: city || hints.city || "",
      postalCode: postalCode || hints.postalCode || "",
      state: hints.state || "",
      county: hints.county || "",
    };

    // 1) Structured met zo veel mogelijk signalen
    const pass1 = await nominatimStructured(want);
    tried.push({ type: "structured", want, got: pass1.length });
    let best = chooseBest(pass1, want);
    if (best) {
      return res.status(200).json({
        lat: Number(best.lat),
        lng: Number(best.lon),
        displayName: best.display_name,
        bbox: best.boundingbox,
        q: want,
        source: "nominatim-structured",
        ...(debug === "1" ? { tried, hints } : {}),
      });
    }

    // 2) Structured zonder state/county
    const pass2 = await nominatimStructured({ city: want.city, postalCode: want.postalCode });
    tried.push({ type: "structured-lite", want: { city: want.city, postalCode: want.postalCode }, got: pass2.length });
    best = chooseBest(pass2, want);
    if (best) {
      return res.status(200).json({
        lat: Number(best.lat),
        lng: Number(best.lon),
        displayName: best.display_name,
        bbox: best.boundingbox,
        q: { city: want.city, postalCode: want.postalCode },
        source: "nominatim-structured-lite",
        ...(debug === "1" ? { tried, hints } : {}),
      });
    }

    // 3) Free-text kandidaten (met FR geforceerd)
    const candidates = [];
    if (want.postalCode || want.city) {
      candidates.push([want.city, want.postalCode, country].filter(Boolean).join(" ").trim());
    }
    if (hints.city || hints.postalCode) {
      candidates.push([hints.city, hints.postalCode, country].filter(Boolean).join(" ").trim());
    }
    if (address) {
      candidates.push([address, want.city || hints.city, country].filter(Boolean).join(" ").trim());
    }

    const triedText = [];
    for (const q of candidates.filter(Boolean)) {
      const list = await nominatimFreeText(q);
      triedText.push({ q, got: list.length });
      best = chooseBest(list, want);
      if (best) {
        return res.status(200).json({
          lat: Number(best.lat),
          lng: Number(best.lon),
          displayName: best.display_name,
          bbox: best.boundingbox,
          q,
          source: "nominatim-text",
          ...(debug === "1" ? { tried, triedText, hints } : {}),
        });
      }
    }

    return res.status(404).json({
      error: "not_found",
      message: "Geen resultaten na structured + text",
      ...(debug === "1" ? { tried, triedText, hints, want } : {}),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
