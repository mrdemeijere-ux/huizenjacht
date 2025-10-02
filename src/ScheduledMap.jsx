// src/ScheduledMap.jsx
import React, { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Marker-icon fix
L.Icon.Default.mergeOptions({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

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
      };
    })
    .filter(Boolean);
}, [items]);

  const center = points.length ? [points[0].lat, points[0].lng] : [52.1, 5.3];
  const zoom = points.length ? 12 : 6;

  return (
    <div className={`w-full overflow-hidden rounded-2xl border border-slate-200 bg-white ${heightClass}`}>
      <MapContainer center={center} zoom={zoom} scrollWheelZoom={true} className="h-full w-full">
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        {points.map(p => (
          <Marker key={p.id || `${p.lat},${p.lng}`} position={[p.lat, p.lng]}>
            <Popup>
              <div className="text-sm">
                {p.title || p.url || "Woning"}
                {p.price ? (
                  <div className="text-xs text-slate-600 mt-1">
                    {new Intl.NumberFormat("nl-NL",{style:"currency",currency:"EUR"}).format(Number(p.price))}
                  </div>
                ) : null}
                {p.url ? (
                  <div className="mt-2">
                    <a href={p.url} target="_blank" rel="noreferrer" className="text-blue-600 underline">Open link</a>
                  </div>
                ) : null}
              </div>
            </Popup>
          </Marker>
        ))}
        <FitBounds points={points} active={active} />
      </MapContainer>
    </div>
  );
}
