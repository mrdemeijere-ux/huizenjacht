// src/ScheduledMap.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Marker-icon fix
L.Icon.Default.mergeOptions({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});
// ---- Mini link preview (thumbnail + titel + host) ----
// ---- Mini link preview (thumbnail + titel + host) ----
// ---- Mini link preview (thumbnail + titel + host) ----
const LINK_PREVIEW_ENDPOINT =
  import.meta?.env?.VITE_LINK_PREVIEW_ENDPOINT || "/api/link-preview";

function MiniLinkPreview({ url, titleFallback, variant = "popup" }) {
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    let alive = true;
    async function run() {
      try {
        if (!url) return;
        const r = await fetch(`${LINK_PREVIEW_ENDPOINT}?url=${encodeURIComponent(url)}`);
        if (!r.ok) return;
        const j = await r.json();
        if (alive) setMeta(j);
      } catch {}
    }
    run();
    return () => { alive = false; };
  }, [url]);

  const title = meta?.title || titleFallback || url;
  const image = meta?.image;
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./,''); } catch { return ""; } })();

  // compact vs popup styling
  const box = variant === "tooltip" ? "h-8 w-8" : "h-12 w-12";
  const titleCls = variant === "tooltip" ? "text-xs font-medium leading-snug line-clamp-1" : "text-sm font-medium leading-snug line-clamp-2";
  const hostCls = variant === "tooltip" ? "text-[10px] text-slate-500 truncate" : "text-xs text-slate-500 truncate";
  const gap = variant === "tooltip" ? "gap-2" : "gap-3";

  return (
    <a href={url} target="_blank" rel="noreferrer" className={`flex items-center ${gap} no-underline`}>
      <div className={`${box} rounded-md overflow-hidden bg-slate-100 border`}>
        {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : null}
      </div>
      <div className="min-w-0">
        <div className={titleCls}>{title}</div>
        <div className={hostCls}>{host}</div>
      </div>
    </a>
  );
}

function FitToMarkers({ points, active }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    // Leaflet in verborgen tab → eerst size fixen
    setTimeout(() => map.invalidateSize(), 150);

    if (!points.length) {
      map.setView([52.1, 5.3], 6); // NL overview
      return;
    }

    if (points.length === 1) {
      const p = points[0];
      map.setView([p.lat, p.lng], 13, { animate: false });
      return;
    }

    const coords = points.map(p => [p.lat, p.lng]);
    const uniq = new Set(coords.map(([lat, lng]) => `${lat},${lng}`));
    let bounds;

    // Als alle punten exact gelijk zijn → kunstmatig klein boxje
    if (uniq.size === 1) {
      const [lat, lng] = coords[0];
      bounds = L.latLngBounds([[lat - 0.01, lng - 0.01], [lat + 0.01, lng + 0.01]]);
    } else {
      bounds = L.latLngBounds(coords);
    }

    map.fitBounds(bounds.pad(0.15), { animate: false, maxZoom: 15 });
  }, [
    map,
    active,
    // dependency gebaseerd op afgeronde coords i.p.v. object-identiteit
    points.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|"),
  ]);

  return null;
}


export default function ScheduledMap({ items = [], active = true, heightClass = "h-[60vh]" }) {
  function toNum(v) {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : null;
}

const points = useMemo(() => {
  return (items || [])
    .map((i) => {
      const lat = toNum(i.lat ?? i.latitude ?? i.coords?.lat);
      const lng = toNum(i.lng ?? i.lon ?? i.longitude ?? i.coords?.lng ?? i.coords?.lon);
      if (lat == null || lng == null) return null;
      return {
        id: i.id,
        lat,
        lng,
        title: i.title,
        url: i.url,
        price: i.price,
        status: i.status,
      };
    })
    .filter(Boolean);
}, [items]);
// --- Robust fit: remount on relevant changes + fit after invalidateSize
const mapRef = useRef(null);

const pointsKey = React.useMemo(
  () => `${active}-${points.map(p => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join("|")}`,
  [active, points]
);

const fit = () => {
  const map = mapRef.current;
  if (!map) return;

  map.invalidateSize();

  if (!points.length) {
    map.setView([52.1, 5.3], 6, { animate: false });
    return;
  }
  if (points.length === 1) {
    const p = points[0];
    map.setView([p.lat, p.lng], 13, { animate: false });
    return;
  }
  const coords = points.map(p => [p.lat, p.lng]);
  const uniq = new Set(coords.map(([a,b]) => `${a},${b}`));
  const bounds = uniq.size === 1
    ? L.latLngBounds([[coords[0][0]-0.01, coords[0][1]-0.01],[coords[0][0]+0.01, coords[0][1]+0.01]])
    : L.latLngBounds(coords);

  map.fitBounds(bounds.pad(0.15), { animate: false, maxZoom: 15 });
};

React.useEffect(() => {
  if (!mapRef.current) return;
  fit();
  const t1 = setTimeout(fit, 100);
  const t2 = setTimeout(fit, 250);
  return () => { clearTimeout(t1); clearTimeout(t2); };
}, [pointsKey]);


  const center = points.length ? [points[0].lat, points[0].lng] : [52.1, 5.3];
  const zoom = points.length ? 12 : 6;

  return (
    <div className={`w-full overflow-hidden rounded-2xl border border-slate-200 bg-white ${heightClass}`}>
      <MapContainer
  key={pointsKey}
  whenCreated={(map) => {
  mapRef.current = map;
  setTimeout(fit, 50);         // na mount
  map.once("load", () => {     // na tiles laden
    setTimeout(fit, 50);
    setTimeout(fit, 200);
  });
}}

  center={center}
  zoom={zoom}
  scrollWheelZoom
  className="h-full w-full"
>

        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        {points.map(p => (
          <Marker key={p.id || `${p.lat},${p.lng}`} position={[p.lat, p.lng]}>
            <Tooltip permanent direction="top" offset={[0, -12]} opacity={1}>
  <div className="flex flex-col gap-1 max-w-[220px]">
    {/* Altijd zichtbare compacte mini-preview */}
    {p.url ? (
      <MiniLinkPreview url={p.url} titleFallback={p.title} variant="tooltip" />
    ) : (
      <div className="text-xs font-medium leading-snug">{p.title || "Woning"}</div>
    )}

    {/* Badges in dezelfde pill-stijl als de tiles */}
    <div className="flex flex-wrap items-center gap-2">
      {p.status ? (
        <span
          className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] text-white
            ${String(p.status).toLowerCase()==="verkocht" ? "bg-red-600" : "bg-blue-600"}`}
        >
          {p.status}
        </span>
      ) : null}

      {Number.isFinite(Number(p.price)) ? (
        <span className="inline-flex items-center rounded-full px-2 py-1 text-[11px] text-white bg-emerald-600 tabular-nums">
          {new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(Number(p.price))}
        </span>
      ) : null}
    </div>
  </div>
</Tooltip>

  <Popup>
  <div className="text-sm max-w-[260px]">
    {/* Mini link preview bovenaan */}
    {p.url ? (
      <MiniLinkPreview url={p.url} titleFallback={p.title} />
    ) : (
      <div className="font-medium leading-snug">{p.title || "Woning"}</div>
    )}

    {/* Pills in dezelfde stijl als tiles */}
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {p.status ? (
        <span
          className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] text-white
            ${String(p.status).toLowerCase()==="verkocht" ? "bg-red-600" : "bg-blue-600"}`}
        >
          {p.status}
        </span>
      ) : null}

      {Number.isFinite(Number(p.price)) ? (
        <span className="inline-flex items-center rounded-full px-2 py-1 text-[11px] text-white bg-emerald-600 tabular-nums">
          {new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(Number(p.price))}
        </span>
      ) : null}
    </div>
  </div>
</Popup>

          </Marker>
        ))}
</MapContainer>
    </div>
  );
}
