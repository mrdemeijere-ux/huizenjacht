// /api/geocode.js — FR disambiguation (postcode/department/region aware)
function norm(s=""){return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();}
function adminName(a){return a?.city||a?.town||a?.village||a?.municipality||a?.hamlet||"";}

async function fetchHtml(url){
  const r=await fetch(url,{headers:{
    "User-Agent":"Huizenjacht/1.0 (+support@example.com)",
    "Accept-Language":"nl-NL,nl;q=0.9,fr;q=0.8,en;q=0.7"}});
  if(!r.ok) throw new Error(`fetch ${r.status}`); return await r.text();
}

function extractHintsFromHtml(html){
  // JSON-LD geo → direct klaar
  const lat=html.match(/"latitude"\s*:\s*"(-?\d+(?:\.\d+)?)"/i)?.[1];
  const lon=html.match(/"longitude"\s*:\s*"(-?\d+(?:\.\d+)?)"/i)?.[1];
  if(lat&&lon){const la=+lat,lo=+lon; if(isFinite(la)&&isFinite(lo)) return {lat:la,lng:lo,direct:true};}

  const hints={};
  // JSON-LD address*
  const pc=html.match(/"postalCode"\s*:\s*"(\d{4,6})"/i)?.[1];
  const city=html.match(/"addressLocality"\s*:\s*"([^"]+)"/i)?.[1];
  const state=html.match(/"addressRegion"\s*:\s*"([^"]+)"/i)?.[1];
  const county=html.match(/"addressCounty"\s*:\s*"([^"]+)"/i)?.[1];
  if(pc) hints.postalCode=pc; if(city) hints.city=city; if(state) hints.state=state; if(county) hints.county=county;

  // Tekstpatroon “Ville (12345)”
  if(!hints.postalCode || !hints.city){
    const m=html.match(/([A-ZÉÈÊÂÀÇÙa-zÀ-ÿ' -]+)\s*\((\d{4,6})\)/);
    if(m){ if(!hints.city) hints.city=m[1]; if(!hints.postalCode) hints.postalCode=m[2]; }
  }

  // Breadcrumbs (IAD heeft bv. “Aude”, “Occitanie” in de pagina)
  const bc=Array.from(html.matchAll(/>(Occitanie|Aude)<\/a>/gi)).map(x=>x[1]);
  if(bc.includes("Aude")) hints.county="Aude";
  if(bc.includes("Occitanie")) hints.state="Occitanie";

  return hints;
}

function cityFromPath(u){
  try{
    const segs=new URL(u).pathname.split("/").filter(Boolean);
    // Zoek segment met letters (sta cijfers toe maar verwijder ze)
    const cand=[...segs].reverse().find(s=>/[a-zA-ZÀ-ÿ]/.test(s) && !s.endsWith(".htm"));
    if(!cand) return "";
    return cand.split("-").filter(tok=>/[a-zA-ZÀ-ÿ]/.test(tok)).join(" ");
  }catch{return "";}
}

async function nominatimStructured({city,postalCode,state,county}){
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

function chooseBest(list,{postalCode,city,state,county}){
  if(!Array.isArray(list)||!list.length) return null;
  if(postalCode){ const e=list.find(x=>x?.address?.postcode===postalCode); if(e) return e; }
  if(county){ const nc=norm(county); const e=list.find(x=>norm(x?.address?.county||"")===nc); if(e) return e; }
  if(state){ const ns=norm(state); const e=list.find(x=>norm(x?.address?.state||"")===ns); if(e) return e; }
  if(city){ const n=norm(city); const e=list.find(x=>norm(adminName(x.address))===n); if(e) return e; }
  return list[0];
}

export default async function handler(req,res){
  try{
    const { url, address="", city="", postalCode="", country="France", debug="0" } = req.query||{};
    let hints={}; let tried=[];

    // Scrape listing
    if(url){
      try{
        const html=await fetchHtml(url);
        const h=extractHintsFromHtml(html);
        if(h?.direct){ return res.status(200).json({lat:h.lat,lng:h.lng,source:"listing-geo"}); }
        hints=h;
        if(!hints.city){ const c=cityFromPath(url); if(c) hints.city=c; }
      }catch{/* ignore */}
    }

    const want={
      city: city || hints.city || "",
      postalCode: postalCode || hints.postalCode || "",
      state: hints.state || "",
      county: hints.county || "",
    };

    // 1) Structured (rijk)
    const s1=await nominatimStructured(want); tried.push({type:"structured", want, got:s1.length});
    let best=chooseBest(s1, want);
    if(best) return res.status(200).json({lat:+best.lat,lng:+best.lon,displayName:best.display_name,source:"nominatim-structured", ...(debug==="1"?{tried,hints}:{} )});

    // 2) Structured (lite: alleen city/postal)
    const s2=await nominatimStructured({city:want.city, postalCode:want.postalCode}); tried.push({type:"structured-lite", want:{city:want.city,postalCode:want.postalCode}, got:s2.length});
    best=chooseBest(s2, want);
    if(best) return res.status(200).json({lat:+best.lat,lng:+best.lon,displayName:best.display_name,source:"nominatim-structured-lite", ...(debug==="1"?{tried,hints}:{} )});

    // 3) Free-text kandidaten
    const cands=[];
    if(want.city||want.postalCode||want.county||want.state) cands.push([want.city, want.postalCode, want.county, want.state, country].filter(Boolean).join(" "));
    if(address) cands.push([address, want.city, want.county, country].filter(Boolean).join(" "));
    if(hints.city||hints.postalCode||hints.county||hints.state) cands.push([hints.city, hints.postalCode, hints.county, hints.state, country].filter(Boolean).join(" "));
    const seen=new Set(); const uniq=cands.map(s=>s.replace(/\s+/g," ").trim()).filter(s=>s&&!seen.has(s)&&seen.add(s));

    const triedText=[];
    for(const q of uniq){
      const r=await nominatimText(q); triedText.push({q, got:r.length});
      best=chooseBest(r, want);
      if(best) return res.status(200).json({lat:+best.lat,lng:+best.lon,displayName:best.display_name,source:"nominatim-text", ...(debug==="1"?{tried,triedText,hints,want}:{} )});
    }

    return res.status(404).json({error:"not_found", message:"Geen resultaten", ...(debug==="1"?{tried,hints,want}:{} )});
  }catch(e){
    return res.status(500).json({error:String(e?.message||e)});
  }
}
