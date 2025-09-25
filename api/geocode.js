// /api/geocode.js — Generieke FR geocoder-aggregator (BAN → Nominatim → text)

function norm(s=""){return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();}
function onlyLetters(s=""){const m=s.match(/[A-Za-zÀ-ÿ' -]+/g); return m?m.join(" ").trim():s.trim();}
function sanitizeCity(raw=""){
  let t = raw.replace(/\s+/g," ").trim();
  const mA = t.match(/(?:^|[^A-Za-zÀ-ÿ])(à|a)\s+([A-Za-zÀ-ÿ' -]+)/i);
  if(mA?.[2]) t = mA[2].trim();
  t = t.replace(/^(vente|location|achat|maison|appartement|terrain|villa|local|bureaux|immeuble|studio)\b.*$/i,"").trim();
  t = onlyLetters(t);
  return t;
}

async function fetchHtml(url){
  const r=await fetch(url,{headers:{
    "User-Agent":"Huizenjacht/1.0 (+support@example.com)",
    "Accept-Language":"nl-NL,nl;q=0.9,fr;q=0.8,en;q=0.7"}});
  if(!r.ok) throw new Error(`fetch ${r.status}`);
  return await r.text();
}

function extractHints(html, url=""){
  const lat=html.match(/"latitude"\s*:\s*"(-?\d+(?:\.\d+)?)"/i)?.[1];
  const lon=html.match(/"longitude"\s*:\s*"(-?\d+(?:\.\d+)?)"/i)?.[1];
  if(lat&&lon){const la=+lat,lo=+lon;if(isFinite(la)&&isFinite(lo)) return { lat:la, lng:lo, direct:true };}

  const hints={};
  const pc=html.match(/"postalCode"\s*:\s*"(\d{4,6})"/i)?.[1];
  let city=html.match(/"addressLocality"\s*:\s*"([^"]+)"/i)?.[1];
  const state=html.match(/"addressRegion"\s*:\s*"([^"]+)"/i)?.[1];
  const county=html.match(/"addressCounty"\s*:\s*"([^"]+)"/i)?.[1];
  if(city) city=sanitizeCity(city);
  if(pc) hints.postalCode=pc; if(city) hints.city=city;
  if(state) hints.state=state; if(county) hints.county=county;

  if(!hints.postalCode||!hints.city){
    const m=html.match(/([A-ZÉÈÊÂÀÇÙa-zÀ-ÿ' -]+)\s*\((\d{4,6})\)/);
    if(m){ if(!hints.city) hints.city=sanitizeCity(m[1]); if(!hints.postalCode) hints.postalCode=m[2]; }
  }

  const mNL=html.match(/in de buurt van\s+([A-ZÉÈÊÂÀÇÙa-zÀ-ÿ' -]+)(?:\s*\((\d{4,6})\))?/i);
  const mFR=html.match(/près de\s+([A-ZÉÈÊÂÀÇÙa-zÀ-ÿ' -]+)(?:\s*\((\d{4,6})\))?/i);
  const mEN=html.match(/near\s+([A-ZÉÈÊÂÀÇÙa-zÀ-ÿ' -]+)(?:\s*\((\d{4,6})\))?/i);
  const near = mNL || mFR || mEN;
  if(near){ if(!hints.city) hints.city=sanitizeCity(near[1]); if(!hints.postalCode && near[2]) hints.postalCode=near[2]; }

  if(!hints.city){
    const title=html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
    if(title){
      const tCity=title.match(/([A-ZÉÈÊÂÀÇÙa-zÀ-ÿ' -]+)\s*\((\d{4,6})\)/) || title.match(/à\s+([A-ZÉÈÊÂÀÇÙa-zÀ-ÿ' -]+)/i);
      if(tCity) hints.city=sanitizeCity(tCity[1]||tCity[0]);
      const tPc=title.match(/\((\d{4,6})\)/);
      if(!hints.postalCode && tPc) hints.postalCode=tPc[1];
    }
  }

  const crumbs=Array.from(html.matchAll(/>([A-ZÉÈÊÂÀÇÙa-zÀ-ÿ' -]+)<\/a>/g)).map(x=>x[1]);
  const has=(s)=>crumbs.some(c=>norm(c)===norm(s));
  const REGIONS=[ "Provence-Alpes-Côte d'Azur","Occitanie","Nouvelle-Aquitaine","Auvergne-Rhône-Alpes","Île-de-France",
    "Bourgogne-Franche-Comté","Grand Est","Hauts-de-France","Normandie","Centre-Val de Loire","Pays de la Loire","Bretagne","Corse" ];
  for(const r of REGIONS){ if(has(r)) hints.state=r; }

  if(url && !hints.city){
    try{
      const segs=new URL(url).pathname.split("/").filter(Boolean);
      const cand=[...segs].reverse().find(s=>/[a-zA-ZÀ-ÿ]/.test(s)&&!s.endsWith(".htm"));
      if(cand){ const name=cand.split("-").filter(tok=>/[a-zA-ZÀ-ÿ]/.test(tok)).join(" "); hints.city=sanitizeCity(name); }
    }catch{}
  }
  return hints;
}

async function banSearch({city, postalCode}){
  if(postalCode){
    const u=new URL("https://api-adresse.data.gouv.fr/search/");
    u.searchParams.set("type","municipality");
    if(city) u.searchParams.set("city", city);
    u.searchParams.set("postcode", postalCode);
    u.searchParams.set("limit","5");
    const r=await fetch(u); if(!r.ok) return [];
    const j=await r.json(); return (j.features||[]).map(f=>({
      lat:f.geometry?.coordinates?.[1],
      lon:f.geometry?.coordinates?.[0],
      address:{ postcode:f.properties?.postcode, city:f.properties?.city, county:f.properties?.context?.split(",")[0]?.trim()||"", state:f.properties?.context?.split(",")[1]?.trim()||"" },
      display_name: `${f.properties?.label}`
    })).filter(x=>x.lat&&x.lon);
  }
  if(city){
    const u=new URL("https://api-adresse.data.gouv.fr/search/");
    u.searchParams.set("type","municipality");
    u.searchParams.set("city", city);
    u.searchParams.set("limit","5");
    const r=await fetch(u); if(!r.ok) return [];
    const j=await r.json(); return (j.features||[]).map(f=>({
      lat:f.geometry?.coordinates?.[1],
      lon:f.geometry?.coordinates?.[0],
      address:{ postcode:f.properties?.postcode, city:f.properties?.city, county:f.properties?.context?.split(",")[0]?.trim()||"", state:f.properties?.context?.split(",")[1]?.trim()||"" },
      display_name: `${f.properties?.label}`
    })).filter(x=>x.lat&&x.lon);
  }
  return [];
}

async function nominatimStructured({city, postalCode, state, county}){
  const u=new URL("https://nominatim.openstreetmap.org/search");
  if(city) u.searchParams.set("city", city);
  if(postalCode) u.searchParams.set("postalcode", postalCode);
  if(state) u.searchParams.set("state", state);
  if(county) u.searchParams.set("county", county);
  u.searchParams.set("country","France");
  u.searchParams.set("countrycodes","fr");
  u.searchParams.set("format","jsonv2");
  u.searchParams.set("limit","5");
  u.searchParams.set("addressdetails","1");
  const r=await fetch(u,{headers:{"User-Agent":"Huizenjacht/1.0 (+support@example.com)"}});
  if(!r.ok) return []; return await r.json();
}

async function nominatimText(q){
  const u=new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("q", q);
  u.searchParams.set("countrycodes","fr");
  u.searchParams.set("format","jsonv2");
  u.searchParams.set("limit","5");
  u.searchParams.set("addressdetails","1");
  const r=await fetch(u,{headers:{"User-Agent":"Huizenjacht/1.0 (+support@example.com)"}});
  if(!r.ok) return []; return await r.json();
}

function pickBest(results, want){
  const {postalCode, city, state, county} = want;
  if(!Array.isArray(results)||!results.length) return null;
  if(postalCode){ const e=results.find(x=>x.address?.postcode===postalCode); if(e) return e; }
  if(county){ const nc=norm(county); const e=results.find(x=>norm(x.address?.county||"")===nc); if(e) return e; }
  if(state){ const ns=norm(state); const e=results.find(x=>norm(x.address?.state||"")===ns); if(e) return e; }
  if(city){ const n=norm(city); const e=results.find(x=>norm((x.address?.city||x.address?.town||x.address?.village||""))===n); if(e) return e; }
  return results[0];
}

export default async function handler(req, res){
  try{
    const { url, address="", city="", postalCode="", country="France", debug="0" } = req.query||{};
    let hints={};

    if(url){
      try{
        const html=await fetchHtml(url);
        const h=extractHints(html, url);
        if(h?.direct){ return res.status(200).json({ lat:h.lat, lng:h.lng, source:"listing-geo" }); }
        hints=h;
      }catch{/* ignore */}
    }

    const want={
      city: sanitizeCity(city || hints.city || ""),
      postalCode: (postalCode || hints.postalCode || "").trim(),
      state: (hints.state || "").trim(),
      county: (hints.county || "").trim(),
    };

    const b1 = await banSearch(want);
    let best = pickBest(b1, want);
    if(best) return res.status(200).json({ lat:+(best.lat||best.latitude), lng:+(best.lon||best.longitude), displayName:best.display_name, source:"ban", ...(debug==="1"?{want,hints}:{} ) });

    const s1 = await nominatimStructured(want);
    best = pickBest(s1, want);
    if(best) return res.status(200).json({ lat:+best.lat, lng:+best.lon, displayName:best.display_name, source:"nominatim-structured", ...(debug==="1"?{want,hints}:{} ) });

    const cands=[];
    if(want.postalCode||want.city||want.county||want.state) cands.push([want.city,want.postalCode,want.county,want.state,country].filter(Boolean).join(" "));
    if(address) cands.push([address,want.city,want.county,country].filter(Boolean).join(" "));
    if(want.postalCode) cands.push([want.postalCode,country].filter(Boolean).join(" "));
    const seen=new Set(); const uniq=cands.map(s=>s.replace(/\s+/g," ").trim()).filter(s=>s&&!seen.has(s)&&seen.add(s));

    for(const q of uniq){
      const r = await nominatimText(q);
      best = pickBest(r, want);
      if(best) return res.status(200).json({ lat:+best.lat, lng:+best.lon, displayName:best.display_name, source:"nominatim-text", ...(debug==="1"?{want,hints,q}:{} ) });
    }

    return res.status(404).json({ error:"not_found", message:"Geen resultaten", ...(debug==="1"?{want,hints}:{} ) });
  }catch(e){
    return res.status(500).json({ error:String(e?.message||e) });
  }
}
