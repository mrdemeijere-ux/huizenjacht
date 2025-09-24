// /api/geocode.js — FR geocoding met disambiguation + Green-Acres hints

function norm(s=""){return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();}
function adminName(a){return a?.city||a?.town||a?.village||a?.municipality||a?.hamlet||"";}
function sanitizeCity(raw=""){
  let t=raw.replace(/\s+/g," ").trim();
  const mA=t.match(/(?:^|[^A-Za-zÀ-ÿ])(à|a)\s+([A-Za-zÀ-ÿ' -]+)(?:\s*[\(|\\|—-]|$)/i);
  if(mA&&mA[2]) t=mA[2].trim();
  t=t.replace(/^(vente|location|achat|maison|appartement|terrain|villa|local|bureaux|immeuble|studio)\b.*$/i,"").trim();
  const mOnly=t.match(/[A-Za-zÀ-ÿ' -]+/); t=mOnly?mOnly[0].trim():t;
  return t;
}

async function fetchHtml(url){
  const r=await fetch(url,{headers:{
    "User-Agent":"Huizenjacht/1.0 (+support@example.com)",
    "Accept-Language":"nl-NL,nl;q=0.9,fr;q=0.8,en;q=0.7"}});
  if(!r.ok) throw new Error(`fetch ${r.status}`);
  return await r.text();
}

// Light mapping voor lastige doublures (alleen als we geen betere hints hebben)
const FALLBACK_POSTCODES = {
  "biot": { postalCode: "06410", county: "Alpes-Maritimes", state: "Provence-Alpes-Côte d'Azur" },
};

function extractHintsGeneric(html){
  // JSON-LD geo → direct klaar
  const lat=html.match(/"latitude"\s*:\s*"(-?\d+(?:\.\d+)?)"/i)?.[1];
  const lon=html.match(/"longitude"\s*:\s*"(-?\d+(?:\.\d+)?)"/i)?.[1];
  if(lat&&lon){const la=+lat,lo=+lon; if(isFinite(la)&&isFinite(lo)) return { lat:la, lng:lo, direct:true };}

  const hints={};
  // JSON-LD address*
  const pc=html.match(/"postalCode"\s*:\s*"(\d{4,6})"/i)?.[1];
  let city=html.match(/"addressLocality"\s*:\s*"([^"]+)"/i)?.[1];
  const state=html.match(/"addressRegion"\s*:\s*"([^"]+)"/i)?.[1];
  const county=html.match(/"addressCounty"\s*:\s*"([^"]+)"/i)?.[1];
  if(city) city=sanitizeCity(city);
  if(pc) hints.postalCode=pc;
  if(city) hints.city=city;
  if(state) hints.state=state;
  if(county) hints.county=county;

  // “Ville (12345)”
  if(!hints.postalCode||!hints.city){
    const m=html.match(/([A-ZÉÈÊÂÀÇÙa-zÀ-ÿ' -]+)\s*\((\d{4,6})\)/);
    if(m){ if(!hints.city) hints.city=sanitizeCity(m[1]); if(!hints.postalCode) hints.postalCode=m[2]; }
  }

  // <title> fallback
  if(!hints.city){
    const title=html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
    if(title){
      const tCity=title.match(/([A-ZÉÈÊÂÀÇÙa-zÀ-ÿ' -]+)\s*\((\d{4,6})\)/) || title.match(/à\s+([A-ZÉÈÊÂÀÇÙa-zÀ-ÿ' -]+)/i);
      if(tCity) hints.city=sanitizeCity(tCity[1]||tCity[0]);
      const tPc=title.match(/\((\d{4,6})\)/);
      if(!hints.postalCode && tPc) hints.postalCode=tPc[1];
    }
  }

  // Regio/dep breadcrumbs (algemene lijst)
  const crumbs=Array.from(html.matchAll(/>([A-ZÉÈÊÂÀÇÙa-zÀ-ÿ' -]+)<\/a>/g)).map(x=>x[1]);
  const inCrumbs=(name)=>crumbs.some(s=>norm(s)===norm(name));
  const REGIONS=[
    "Provence-Alpes-Côte d'Azur","Occitanie","Nouvelle-Aquitaine","Auvergne-Rhône-Alpes","Île-de-France",
    "Bourgogne-Franche-Comté","Grand Est","Hauts-de-France","Normandie","Centre-Val de Loire",
    "Pays de la Loire","Bretagne","Corse"
  ];
  const DEPTS=[
    "Alpes-Maritimes","Var","Bouches-du-Rhône","Vaucluse","Hautes-Alpes","Alpes-de-Haute-Provence",
    "Aude","Hérault","Gard","Pyrénées-Orientales","Haute-Garonne","Tarn","Ariège",
    "Dordogne","Gironde","Landes","Charente","Charente-Maritime","Haute-Savoie","Savoie","Isère","Ain"
  ];
  for(const r of REGIONS){ if(inCrumbs(r)) hints.state=r; }
  for(const d of DEPTS){ if(inCrumbs(d)) hints.county=d; }

  return hints;
}

function cityFromPath(u){
  try{
    const segs=new URL(u).pathname.split("/").filter(Boolean);
    // Zoek laatste betekenisvolle segment
    const cand=[...segs].reverse().find(s=>/[a-zA-ZÀ-ÿ]/.test(s) && !s.endsWith(".htm") && !["properties","property","makelaar","nl","fr","en","es"].includes(s.toLowerCase()));
    if(!cand) return "";
    const name=cand.split("-").filter(tok=>/[a-zA-ZÀ-ÿ]/.test(tok)).join(" ");
    return sanitizeCity(name);
  }catch{return "";}
}

function greenAcresHostHints(url, html){
  const hints = extractHintsGeneric(html);
  // Specifiek: als city ontbreekt, haal die uit het pad
  if(!hints.city){
    const c=cityFromPath(url);
    if(c) hints.city=c;
  }
  // Als het expliciet om “biot” gaat en we nog geen postcode/dep/region hebben, vul bekend setje in
  if(hints.city && norm(hints.city)==="biot"){
    if(!hints.postalCode || !hints.county || !hints.state){
      const f=FALLBACK_POSTCODES["biot"];
      hints.postalCode = hints.postalCode || f.postalCode;
      hints.county = hints.county || f.county;
      hints.state = hints.state || f.state;
    }
  }
  return hints;
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

function chooseBest(results,{postalCode,city,state,county}){
  if(!Array.isArray(results)||!results.length) return null;
  if(postalCode){ const e=results.find(x=>x?.address?.postcode===postalCode); if(e) return e; }
  if(county){ const nc=norm(county); const e=results.find(x=>norm(x?.address?.county||"")===nc); if(e) return e; }
  if(state){ const ns=norm(state); const e=results.find(x=>norm(x?.address?.state||"")===ns); if(e) return e; }
  if(city){ const n=norm(city); const e=results.find(x=>norm(adminName(x.address))===n); if(e) return e; }
  return results[0];
}

export default async function handler(req,res){
  try{
    const { url, address="", city="", postalCode="", country="France", debug="0" } = req.query||{};
    let hints={}; const tried=[];

    if(url){
      try{
        const html=await fetchHtml(url);
        const uHost=new URL(url).hostname.toLowerCase();
        if(uHost.includes("green-acres.")){
          const h=greenAcresHostHints(url, html);
          if(h?.direct){ return res.status(200).json({lat:h.lat,lng:h.lng,source:"listing-geo"}); }
          hints=h;
        }else{
          const h=extractHintsGeneric(html);
          if(h?.direct){ return res.status(200).json({lat:h.lat,lng:h.lng,source:"listing-geo"}); }
          hints=h;
          if(!hints.city){ const c=cityFromPath(url); if(c) hints.city=c; }
        }
      }catch{/* ignore */}
    }

    const want={
      city: sanitizeCity(city || hints.city || ""),
      postalCode: (postalCode || hints.postalCode || "").trim(),
      state: (hints.state || "").trim(),
      county: (hints.county || "").trim(),
    };

    // 1) Structured (rijk)
    const s1=await nominatimStructured(want); tried.push({type:"structured", want, got:s1.length});
    let best=chooseBest(s1, want);
    if(best) return res.status(200).json({lat:+best.lat,lng:+best.lon,displayName:best.display_name,source:"nominatim-structured", ...(debug==="1"?{tried,hints}:{} )});

    // 2) Structured (lite)
    const s2=await nominatimStructured({city:want.city, postalCode:want.postalCode}); tried.push({type:"structured-lite", want:{city:want.city,postalCode:want.postalCode}, got:s2.length});
    best=chooseBest(s2, want);
    if(best) return res.status(200).json({lat:+best.lat,lng:+best.lon,displayName:best.display_name,source:"nominatim-structured-lite", ...(debug==="1"?{tried,hints}:{} )});

    // 3) Free-text (incl. pure postcode)
    const cands=[];
    if(want.postalCode||want.city||want.county||want.state) cands.push([want.city,want.postalCode,want.county,want.state,country].filter(Boolean).join(" "));
    if(address) cands.push([address,want.city,want.county,country].filter(Boolean).join(" "));
    if(want.postalCode) cands.push([want.postalCode,country].filter(Boolean).join(" "));
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
