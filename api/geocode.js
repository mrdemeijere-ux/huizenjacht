// api/geocode.js — Vercel serverless functie
export const config = { runtime: "edge" };
function json(data, init = 200) { return new Response(JSON.stringify(data, null, 2), { status: typeof init === "number" ? init : 200, headers: { "content-type": "application/json; charset=utf-8" }, }); }
function parseUrlParts(raw) { try { const u = new URL(raw); const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent); return { host: u.hostname.replace(/^www\./, ""), parts }; } catch { return { host: "", parts: [] }; } }
function extractHintsFromUrl(raw) {
  const { host, parts } = parseUrlParts(raw || ""); const hints = {};
  const guessFromSegments = (segs) => (segs || []).filter(Boolean).map((s) => s.replace(/-/g, " "));
  if (host.includes("green-acres")) { const segs = guessFromSegments(parts); const citySeg = segs.findLast?.((s) => /^[a-zà-ÿ\s']+$/i.test(s)) || segs.at(-2); if (citySeg) hints.city = citySeg.trim(); }
  if (host.includes("iadfrance")) { const segs = guessFromSegments(parts); const citySeg = segs.find((s) => /\b(vente|maison|appartement)\b/i.test(s)) ? segs.find((s) => /\b\d{5}\b/.test(s)) : segs[0]; if (citySeg) hints.city = citySeg.trim(); }
  return hints;
}
export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get("url") || ""; const address = searchParams.get("address") || ""; const city = searchParams.get("city") || ""; const postalCode = searchParams.get("postalCode") || ""; const country = searchParams.get("country") || "France";
    const urlHints = extractHintsFromUrl(url);
    const want = { city: (city || urlHints.city || "").trim(), postalCode: (postalCode || "").trim(), state: "", county: "" };
    const params = new URLSearchParams({ format: "json", addressdetails: "1", limit: "1", country: country || "France" });
    if (want.city) params.set("city", want.city); if (want.postalCode) params.set("postalcode", want.postalCode); if (address) params.set("street", address);
    const tried = []; let best = null;
    const structured = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
    let r = await fetch(structured, { headers: { "User-Agent": "Huizenjacht/1.0" } }); let arr = await r.json();
    tried.push({ type: "structured", want, got: Array.isArray(arr) ? arr.length : 0 }); if (Array.isArray(arr) && arr[0]) { best = arr[0]; }
    if (!best && (want.city || want.postalCode)) {
      const q = [want.city, want.postalCode, country].filter(Boolean).join(", "); const p2 = new URLSearchParams({ format: "json", q, limit: "1", addressdetails: "1" });
      r = await fetch(`https://nominatim.openstreetmap.org/search?${p2.toString()}`, { headers: { "User-Agent": "Huizenjacht/1.0" } }); arr = await r.json();
      tried.push({ type: "q-fallback", q, got: Array.isArray(arr) ? arr.length : 0 }); if (Array.isArray(arr) && arr[0]) best = arr[0];
    }
    if (!best) { return json({ error: "not_found", message: "Geen resultaten", tried, hints: { ...urlHints, city: want.city, postalCode: want.postalCode }, want }, 404); }
    const lat = Number(best.lat); const lng = Number(best.lon); const displayName = best.display_name;
    return json({ lat, lng, displayName, source: "nominatim-structured", tried, hints: { ...urlHints, city: want.city, postalCode: want.postalCode } });
  } catch (e) { return json({ error: "server_error", message: String(e?.message || e) }, 500); }
}
