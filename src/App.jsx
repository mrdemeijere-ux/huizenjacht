import React, { useEffect, useMemo, useState } from "react";

// Huizenjacht – single-file MVP (React + Tailwind + Firestore realtime sync)
// Altijd online opslag (Firebase Firestore) – geen boards of lokale opslag
// Features:
// - Add properties: titel, link, adres/GPS, makelaar/agency, status, notities, datum/tijd, prijs (EUR)
// - Inline wijzigen: status & bezichtigingsdatum in de lijst
// - Beoordelingen (★ 1–5): overall, locatie, bereikbaarheid, business, renovatie (5=weinig budget), parkeren, zwembad, privévertrekken, realiseerbaarheid
// - Realtime sync via Firestore (collectie boards/global/items)
// - LinkChip (compacte host-chip) + SmartLinkPreview (rijke preview via serverless endpoint)

// ===================== Firebase setup =====================
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";

// 🔧 Vervang met jouw Firebase config of via Vite env vars (Vercel)
const firebaseConfig = {
  apiKey: import.meta?.env?.VITE_FIREBASE_API_KEY || "AIzaSyAixsEtpf-ZxVEXENyDFdljLVj5jH5Wloo",
  authDomain: import.meta?.env?.VITE_FIREBASE_AUTH_DOMAIN || "huizenjacht-550d8.firebaseapp.com",
  projectId: import.meta?.env?.VITE_FIREBASE_PROJECT_ID || "huizenjacht-550d8",
  storageBucket: import.meta?.env?.VITE_FIREBASE_STORAGE_BUCKET || "huizenjacht-550d8.firebasestorage.app",
  messagingSenderId: import.meta?.env?.VITE_FIREBASE_MESSAGING_SENDER_ID || "460752433385",
  appId: import.meta?.env?.VITE_FIREBASE_APP_ID || "1:460752433385:web:6aec831191354c0c608078",
};

function isFirebaseConfigured(cfg) {
  const vals = Object.values(cfg || {});
  return vals.every((v) => typeof v === "string" && v && !String(v).startsWith("YOUR_"));
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false,
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// ===================== Constants =====================
const STATUS_OPTIONS = [
  { value: "interessant", label: "Interessant" },
  { value: "afspraak", label: "Afspraak maken" },
  { value: "ingepland", label: "Ingepland voor bezichtiging" },
  { value: "bezichtigd", label: "Bezichtigd" },
  { value: "verkocht", label: "Verkocht" },
];

// ===================== Helpers =====================
function uuid() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function badgeClass(status) {
  const base = "px-2 py-1 rounded-full text-xs font-medium";
  switch (status) {
    case "interessant":
      return `${base} bg-blue-100 text-blue-800`;
    case "afspraak":
      return `${base} bg-amber-100 text-amber-800`;
    case "ingepland":
      return `${base} bg-purple-100 text-purple-800`;
    case "bezichtigd":
      return `${base} bg-green-100 text-green-800`;
    case "verkocht":
      return `${base} bg-zinc-200 text-zinc-800 line-through`;
    default:
      return `${base} bg-zinc-100 text-slate-800`;
  }
}

function defaultRatings() {
  return {
    overall: 0,
    location: 0,
    accessibility: 0,
    business: 0,
    renovation: 0, // 5 = weinig budget nodig
    parking: 0,
    pool: 0,
    privateAreas: 0,
    feasibility: 0,
  };
}

function emptyForm() {
  return {
    id: uuid(),
    title: "",
    url: "",
    address: "",
    city: "",
    postalCode: "",
    country: "France",
    lat: "",
    lng: "",
    agencyName: "", // Makelaardij
    agentName: "",
    agentPhone: "",
    agentEmail: "",
    status: "",
    viewingAt: "",
    notes: "",
    price: 0,
    ratings: defaultRatings(),
    order: Date.now(),
  };
}

function validate(item) {
  const errors = {};
  if (!item.title?.trim()) errors.title = "Titel is verplicht";
  if (!item.url?.trim()) errors.url = "Link is verplicht";
  if (!item.address?.trim() && !(item.lat && item.lng)) errors.address = "Adres of GPS is verplicht";
  if (!item.city?.trim() && !(item.lat && item.lng)) errors.city = "Plaats is verplicht";
  if (!item.status) errors.status = "Status is verplicht";
  return errors;
}

function formatEUR(value) {
  try {
    if (value == null || value === "" || isNaN(Number(value))) return "";
    return new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(Number(value));
  } catch {
    return `€ ${Number(value || 0).toLocaleString("nl-NL")}`;
  }
}

function getUrlParts(u) {
  try {
    const url = new URL(u);
    return { host: url.hostname.replace(/^www\./, ""), path: (url.pathname + url.search).replace(/\/$/, "") || "/" };
  } catch {
    return { host: u, path: "" };
  }
}
function hostInitial(host) {
  const h = (host || "?").trim();
  return (h[0] || "?").toUpperCase();
}

// Compacte link-chip (in de kopregel)
function LinkChip({ url }) {
  if (!url) return null;
  const parts = getUrlParts(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-[180px] items-center gap-1 rounded-full border px-2 py-0.5 text-xs hover:bg-slate-50"
      title={url}
    >
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700">
        {hostInitial(parts.host)}
      </span>
      <span className="truncate">{parts.host}</span>
    </a>
  );
}

// Rijke link preview (server-side metadata fetch via Vercel function)
function SmartLinkPreview({ url }) {
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const endpoint = import.meta?.env?.VITE_LINK_PREVIEW_ENDPOINT;
  const parts = getUrlParts(url || "");

  useEffect(() => {
    let alive = true;
    setError(null);
    setMeta(null);
    if (!endpoint || !url) return;

    setLoading(true);
    const target = `${endpoint}?url=${encodeURIComponent(url)}`;
    fetch(target)
      .then(async (r) => {
        if (!alive) return;
        if (!r.ok) {
          setError(`HTTP ${r.status}`);
          return;
        }
        const data = await r.json().catch(() => null);
        if (!alive) return;
        if (data && (data.title || data.image || data.description)) {
          setMeta(data);
        } else {
          setMeta(null);
        }
      })
      .catch((e) => {
        if (!alive) return;
        setError(e?.message || String(e));
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [endpoint, url]);

  if (!endpoint || !url) return null; // endpoint niet geconfigureerd → sla over

  if (meta) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex gap-3 rounded-xl border bg-white hover:bg-slate-50 transition px-3 py-3"
      >
        {meta.image ? (
          <img src={meta.image} alt="" className="h-16 w-24 rounded-lg object-cover border" />
        ) : (
          <div className="h-16 w-24 rounded-lg bg-slate-100 border flex items-center justify-center text-slate-400 text-xs">
            {hostInitial(parts.host)}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{meta.title || parts.host}</div>
          {meta.description && (
            <div className="mt-0.5 line-clamp-2 text-xs text-slate-600">{meta.description}</div>
          )}
          <div className="mt-1 text-[11px] text-slate-500 truncate">{meta.siteName || parts.host}</div>
        </div>
      </a>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-xl border bg-slate-50 px-3 py-2 animate-pulse">
        <div className="h-6 w-6 rounded-full bg-slate-200" />
        <div className="flex-1 space-y-1">
          <div className="h-3 w-40 bg-slate-200 rounded" />
          <div className="h-2 w-24 bg-slate-200 rounded" />
        </div>
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between gap-3 rounded-xl border bg-slate-50 px-3 py-2"
      title={error ? `Preview niet beschikbaar: ${error}` : url}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="h-6 w-6 rounded-md bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-700">
          {hostInitial(parts.host)}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{parts.host || "Open link"}</div>
          {parts.path && <div className="truncate text-[11px] text-slate-600">{parts.path}</div>}
        </div>
      </div>
      <span className="rounded-lg border px-2 py-1 text-[11px] text-slate-700">Open</span>
    </a>
  );
}

function StarRating({ value = 0, onChange, size = "md", label, hint }) {
  const stars = [1, 2, 3, 4, 5];
  const cls = size === "sm" ? "text-sm" : size === "lg" ? "text-xl" : "text-base";
  return (
    <div className="flex items-center gap-2">
      {label && <span className="w-48 text-sm text-slate-700">{label}</span>}
      <div className="flex items-center">
        {stars.map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${label || "Score"} ${n} ster${n > 1 ? "ren" : ""}`}
            className={`${cls} leading-none px-0.5`}
            onClick={() => onChange?.(n)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") onChange?.(Math.min(5, (value || 0) + 1));
              if (e.key === "ArrowLeft") onChange?.(Math.max(1, (value || 0) - 1));
            }}
          >
            <span className={n <= (value || 0) ? "" : "opacity-30"}>★</span>
          </button>
        ))}
      </div>
      {value ? (
        <span className="text-xs text-slate-600">{value}/5</span>
      ) : (
        <span className="text-xs text-slate-400">–</span>
      )}
      {hint && <span className="ml-2 text-[11px] text-slate-500">{hint}</span>}
    </div>
  );
}

function averageRating(ratings) {
  if (!ratings) return 0;
  const vals = Object.values(ratings).filter((v) => Number(v) > 0);
  if (vals.length === 0) return 0;
  return Math.round((vals.reduce((a, b) => a + Number(b), 0) / vals.length) * 10) / 10;
}

function TopStatusBar({ liveStatus }) {
  return (
    <div className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto max-w-6xl px-6 py-2 text-xs text-slate-700 flex items-center justify-between">
        <div>⚡ Sync: <span className="font-medium">{liveStatus}</span> · Opslag: Firebase</div>
      </div>
    </div>
  );
}

// ===================== App =====================
export default function App() {
  const [items, setItems] = useState([]); // altijd online
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState("createdDesc");
  const [errors, setErrors] = useState({});
  const [activeTab, setActiveTab] = useState("all");

  const [user, setUser] = useState(null);
  const boardId = "global"; // vaste opslaglocatie
  const [liveStatus, setLiveStatus] = useState("offline");
  const [syncError, setSyncError] = useState(null);
  const [configOk] = useState(isFirebaseConfigured(firebaseConfig));

  // Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      if (!u) signInAnonymously(auth).catch((e) => console.error("anon auth failed", e));
    });
    return () => unsub();
  }, []);

  // Firestore subscription (altijd actief)
  useEffect(() => {
    if (!user) return;

    // Zorg dat board-doc bestaat (globaal)
    setDoc(doc(db, "boards", boardId), { createdAt: serverTimestamp() }, { merge: true }).catch(() => {});

    const qRef = query(collection(db, "boards", boardId, "items"), orderBy("order", "desc"));

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const list = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
        setItems(list);
        setLiveStatus("online");
        setSyncError(null);
      },
      (err) => {
        console.error("onSnapshot error", err);
        setLiveStatus("error");
        setSyncError(err);
      }
    );

    return () => {
      setLiveStatus("offline");
      unsub();
    };
  }, [user]);

  function resetForm() {
    setForm(emptyForm());
    setErrors({});
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const { id: _drop, ...formNoId } = form; // id niet meesturen
    const withMeta = { ...formNoId, createdAt: serverTimestamp(), order: Date.now() };

    try {
      await addDoc(collection(db, "boards", boardId, "items"), withMeta);
      resetForm();
      setActiveTab("all");
    } catch (err) {
      alert("Opslaan in Firestore mislukt: " + (err?.message || String(err)));
    }
  }

  function startEdit(it) {
    setEditingId(it.id);
    setForm({ ...it });
    setActiveTab("new");
  }

  async function saveEdit() {
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;

    try {
      const { id: _idDrop, ...payload } = form; // id niet in payload
      await updateDoc(doc(db, "boards", boardId, "items", editingId), payload);
      setEditingId(null);
      resetForm();
      setActiveTab("all");
    } catch (err) {
      alert("Bijwerken mislukt: " + (err?.message || String(err)));
    }
  }

  function cancelEdit() {
    setEditingId(null);
    resetForm();
  }

  async function remove(id) {
    if (!confirm("Weet je zeker dat je deze woning wilt verwijderen?")) return;
    try {
      await deleteDoc(doc(db, "boards", boardId, "items", id));
    } catch (err) {
      alert("Verwijderen mislukt: " + (err?.message || String(err)));
    }
  }

  async function move(id, dir) {
    const idx = items.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const swapWith = dir === "up" ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= items.length) return;

    try {
      const a = items[idx];
      const b = items[swapWith];
      await Promise.all([
        updateDoc(doc(db, "boards", boardId, "items", a.id), { order: b.order || 0 }),
        updateDoc(doc(db, "boards", boardId, "items", b.id), { order: a.order || 0 }),
      ]);
    } catch (err) {
      alert("Volgorde wijzigen mislukt: " + (err?.message || String(err)));
    }
  }

  async function updateItem(id, patch) {
    try {
      await updateDoc(doc(db, "boards", boardId, "items", id), patch);
    } catch (err) {
      alert("Opslaan mislukt: " + (err?.message || String(err)));
    }
  }

  async function updateRating(id, key, val) {
    const it = items.find((x) => x.id === id);
    const current = it?.ratings || defaultRatings();
    const patch = { ratings: { ...current, [key]: val } };
    await updateItem(id, patch);
  }

  const visible = useMemo(() => {
    let v = [...items];
    if (filter.trim()) {
      const q = filter.toLowerCase();
      v = v.filter((it) =>
        [
          it.title,
          it.address,
          it.city,
          it.postalCode,
          it.country,
          it.agencyName,
          it.agentName,
          it.agentEmail,
          it.agentPhone,
          it.notes,
          it.price != null ? String(it.price) : "",
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    if (statusFilter) v = v.filter((it) => it.status === statusFilter);
    if (sortBy === "createdDesc") v.sort((a, b) => (b.order || 0) - (a.order || 0));
    if (sortBy === "cityAsc") v.sort((a, b) => (a.city || "").localeCompare(b.city || ""));
    if (sortBy === "statusAsc") v.sort((a, b) => (a.status || "").localeCompare(b.status || ""));
    if (sortBy === "priceAsc") v.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
    if (sortBy === "priceDesc") v.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
    return v;
  }, [items, filter, statusFilter, sortBy]);

  const scheduledVisible = useMemo(() => {
    return items
      .filter((it) => it.viewingAt)
      .slice()
      .sort((a, b) => new Date(a.viewingAt) - new Date(b.viewingAt));
  }, [items]);

  const isEditing = Boolean(editingId);

  function formatViewing(dt) {
    if (!dt) return "";
    try {
      const asDate = new Date(dt);
      if (!isNaN(asDate)) return asDate.toLocaleString();
      return dt;
    } catch {
      return dt;
    }
  }

  // ===================== Render =====================
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900 pb-24">
      <TopStatusBar liveStatus={liveStatus} />
      <div className="mx-auto max-w-6xl p-6">
        <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Huizenjacht – MVP</h1>
            <p className="text-sm text-slate-600">Beheer bezichtigingen, makelaars en routes. Realtime sync via Firebase.</p>
          </div>
        </header>

        {syncError && (
          <div className="mb-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
            <div className="font-semibold">Sync fout</div>
            <div className="mt-1">
              <code className="rounded bg-white/60 px-1">{syncError.code || "unknown"}</code> · {syncError.message || String(syncError)}
            </div>
          </div>
        )}

        {/* Formulier */}
        <section className={`mb-8 rounded-2xl border bg-white p-4 shadow-sm ${activeTab==='new' ? '' : 'hidden'}`}>
          <h2 className="mb-3 text-lg font-semibold">{isEditing ? "Woning bewerken" : "Nieuwe woning toevoegen"}</h2>
          <form onSubmit={isEditing ? (e) => { e.preventDefault(); saveEdit(); } : handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Titel / Naam woning<span className="text-rose-600">*</span></label>
              <input className={`mt-1 w-full rounded-xl border px-3 py-2 ${errors.title ? "border-rose-400" : ""}`} placeholder="Bijv. Charmehuisje bij Dijon" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              {errors.title && <p className="text-xs text-rose-600">{errors.title}</p>}
            </div>
            <div>
              <label className="text-sm font-medium">Link naar woning<span className="text-rose-600">*</span></label>
              <input className={`mt-1 w-full rounded-xl border px-3 py-2 ${errors.url ? "border-rose-400" : ""}`} placeholder="https://..." value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
              {errors.url && <p className="text-xs text-rose-600">{errors.url}</p>}
            </div>

            <div className="md:col-span-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-sm font-medium">Adres<span className="text-rose-600">*</span></label>
                <input className={`mt-1 w-full rounded-xl border px-3 py-2 ${errors.address ? "border-rose-400" : ""}`} placeholder="Rue de ... 12" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                {errors.address && <p className="text-xs text-rose-600">{errors.address}</p>}
              </div>
              <div>
                <label className="text-sm font-medium">Postcode<span className="text-rose-600 opacity-0">*</span></label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" placeholder="75001" value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Plaats<span className="text-rose-600">*</span></label>
                <input className={`mt-1 w-full rounded-xl border px-3 py-2 ${errors.city ? "border-rose-400" : ""}`} placeholder="Paris" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                {errors.city && <p className="text-xs text-rose-600">{errors.city}</p>}
              </div>
              <div>
                <label className="text-sm font-medium">Land</label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Prijs (EUR)</label>
              <input type="number" inputMode="decimal" className="mt-1 w-full rounded-xl border px-3 py-2" placeholder="350000" value={form.price ?? ""} onChange={(e) => setForm({ ...form, price: e.target.value === "" ? "" : Number(e.target.value) })} />
              <p className="text-xs text-slate-500 mt-1">Vul een bedrag in zonder punten of €-teken, bijv. 350000.</p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium">GPS Latitude (opt.)</label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" placeholder="48.8566" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">GPS Longitude (opt.)</label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" placeholder="2.3522" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 md:col-span-2">
              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Makelaardij</label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" placeholder="Agence BelleMaison" value={form.agencyName} onChange={(e) => setForm({ ...form, agencyName: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Makelaar naam</label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" placeholder="Mme Dupont" value={form.agentName} onChange={(e) => setForm({ ...form, agentName: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Makelaar telefoon</label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" placeholder="+33 ..." value={form.agentPhone} onChange={(e) => setForm({ ...form, agentPhone: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Makelaar e‑mail</label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" placeholder="makelaar@bedrijf.fr" value={form.agentEmail} onChange={(e) => setForm({ ...form, agentEmail: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Geplande bezichtiging (datum/tijd)</label>
                <input type="datetime-local" className="mt-1 w-full max-w-full min-w-0 appearance-none rounded-xl border px-3 py-2" value={form.viewingAt} onChange={(e) => setForm({ ...form, viewingAt: e.target.value })} />
                <p className="mt-1 text-xs text-slate-500">Tip: dit gebruikt je lokale tijdzone.</p>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Status<span className="text-rose-600">*</span></label>
              <select className={`mt-1 w-full rounded-xl border px-3 py-2 ${errors.status ? "border-rose-400" : ""}`} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="">— Kies status —</option>
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {errors.status && <p className="text-xs text-rose-600">{errors.status}</p>}
            </div>

            <div>
              <label className="text-sm font-medium">Notities</label>
              <textarea className="mt-1 w-full rounded-xl border px-3 py-2" rows={2} placeholder="Parkeren bij achteringang, sleutel ophalen bij buur..." value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>

            <div className="md:col-span-2 flex items-center gap-2 pt-2">
              {!isEditing && (
                <button className="rounded-2xl bg-slate-900 px-4 py-2 text-white shadow hover:opacity-90" type="submit">Toevoegen</button>
              )}
              {isEditing && (
                <>
                  <button className="rounded-2xl bg-slate-900 px-4 py-2 text-white shadow hover:opacity-90" type="button" onClick={saveEdit}>Opslaan</button>
                  <button className="rounded-2xl border px-4 py-2 shadow-sm" type="button" onClick={cancelEdit}>Annuleren</button>
                </>
              )}
              <button type="button" className="ml-auto rounded-2xl border px-3 py-2 text-sm shadow-sm" onClick={resetForm}>Formulier leegmaken</button>
            </div>
          </form>
        </section>

        {/* Filters/Sortering */}
        <section className={`mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between ${activeTab==='all' ? '' : 'hidden'}`}>
          <div className="flex gap-2">
            <input className="w-64 rounded-xl border px-3 py-2" placeholder="Zoek op adres, plaats, makelaar..." value={filter} onChange={(e) => setFilter(e.target.value)} />
            <select className="rounded-xl border px-3 py-2" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Alle statussen</option>
              {STATUS_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
          </div>
          <div className="flex gap-2">
            <label className="text-sm">Sorteren:
              <select className="ml-2 rounded-xl border px-3 py-2" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="createdDesc">Nieuwste eerst</option>
                <option value="cityAsc">Plaats A→Z</option>
                <option value="statusAsc">Status A→Z</option>
                <option value="priceAsc">Prijs laag → hoog</option>
                <option value="priceDesc">Prijs hoog → laag</option>
              </select>
            </label>
          </div>
        </section>

        {/* Lijst */}
        <section className={`space-y-3 ${activeTab==='all' ? '' : 'hidden'}`}>
          {visible.length === 0 && (
            <div className="rounded-2xl border bg-white p-6 text-center text-slate-600">Nog geen woningen opgeslagen.</div>
          )}
          {visible.map((it, idx) => (
            <article key={it.id} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="grow">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <h3 className="text-lg font-semibold">{it.title || "(Geen titel)"}</h3>
                      <span className={badgeClass(it.status)}>{STATUS_OPTIONS.find((s) => s.value === it.status)?.label || it.status}</span>
                      {it.url && <LinkChip url={it.url} />}
                      {Number(it.price) > 0 && (
                        <span className="ml-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{formatEUR(it.price)}</span>
                      )}
                      {averageRating(it.ratings) > 0 && (
                        <span className="ml-2 rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-amber-700">⭐ {averageRating(it.ratings)}/5</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-700">
                      {it.address && <span>{it.address}, </span>}
                      {[it.postalCode, it.city].filter(Boolean).join(" ")}
                      {it.country ? `, ${it.country}` : ""}
                    </p>
                    {it.agencyName && (<p className="text-xs text-slate-600">Makelaardij: {it.agencyName}</p>)}
                    {(it.agentName || it.agentPhone || it.agentEmail) && (
                      <p className="text-xs text-slate-600">Makelaar: {[it.agentName, it.agentPhone, it.agentEmail].filter(Boolean).join(" · ")}</p>
                    )}

                    {/* Inline wijzigen: status + datum/tijd */}
                    <div className="mt-2 flex flex-wrap items-center gap-2 min-w-0">
                      <label className="text-xs text-slate-600">Status</label>
                      <select className="rounded-lg border px-2 py-1 text-xs" value={it.status} onChange={(e) => updateItem(it.id, { status: e.target.value })}>
                        {STATUS_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                      </select>

                      <label className="ml-2 text-xs text-slate-600">Bezichtiging</label>
                      <input type="datetime-local" className="rounded-lg border px-2 py-1 text-xs w-full sm:w-auto min-w-0 max-w-full appearance-none" value={it.viewingAt || ""} onChange={(e) => updateItem(it.id, { viewingAt: e.target.value })} />
                      {it.viewingAt && (<span className="text-xs text-slate-600">({formatViewing(it.viewingAt)})</span>)}
                    </div>

                    {/* Beoordelingen */}
                    <div className="mt-3 rounded-xl border bg-slate-50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <h4 className="text-sm font-semibold">Beoordeling</h4>
                        <span className="text-xs text-slate-600">Gemiddelde: {averageRating(it.ratings) || "–"}/5</span>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <StarRating value={it.ratings?.overall || 0} onChange={(v) => updateRating(it.id, "overall", v)} label="Algehele indruk" />
                        <StarRating value={it.ratings?.location || 0} onChange={(v) => updateRating(it.id, "location", v)} label="Locatie / Ligging" />
                        <StarRating value={it.ratings?.accessibility || 0} onChange={(v) => updateRating(it.id, "accessibility", v)} label="Bereikbaarheid" />
                        <StarRating value={it.ratings?.business || 0} onChange={(v) => updateRating(it.id, "business", v)} label="Bedrijfspotentieel" />
                        <StarRating value={it.ratings?.renovation || 0} onChange={(v) => updateRating(it.id, "renovation", v)} label="Benodigd verbouwingsbudget" hint="5 = weinig budget nodig" />
                        <StarRating value={it.ratings?.parking || 0} onChange={(v) => updateRating(it.id, "parking", v)} label="Parkeergelegenheid" />
                        <StarRating value={it.ratings?.pool || 0} onChange={(v) => updateRating(it.id, "pool", v)} label="Zwembad" />
                        <StarRating value={it.ratings?.privateAreas || 0} onChange={(v) => updateRating(it.id, "privateAreas", v)} label="Privévertrekken" />
                        <StarRating value={it.ratings?.feasibility || 0} onChange={(v) => updateRating(it.id, "feasibility", v)} label="Realiseerbaarheid" />
                      </div>
                      {it.status !== "bezichtigd" && (
                        <p className="mt-2 text-xs text-slate-500">Tip: markeer de status als <em>Bezichtigd</em> zodra je de beoordeling definitief maakt.</p>
                      )}
                    </div>

                    {it.notes && <p className="mt-2 text-sm text-slate-600">🗒️ {it.notes}</p>}
                  </div>

                  <div className="flex flex-wrap items-start gap-2">
                    <a href={buildGoogleMapsUrl(it)} target="_blank" rel="noopener noreferrer" className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50">Google Maps</a>
                    <a href={buildOsmUrl(it)} target="_blank" rel="noopener noreferrer" className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50">OpenStreetMap</a>
                    <button onClick={() => startEdit(it)} className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50">Bewerken</button>
                    <button onClick={() => remove(it.id)} className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-rose-50">Verwijderen</button>
                    <button onClick={() => move(it.id, "up")} disabled={idx === 0} className="rounded-xl border px-3 py-2 text-sm shadow-sm disabled:opacity-40">↑</button>
                    <button onClick={() => move(it.id, "down")} disabled={idx === visible.length - 1} className="rounded-xl border px-3 py-2 text-sm shadow-sm disabled:opacity-40">↓</button>
                  </div>
                </div>

                {/* Rijke link preview */}
                {it.url && <SmartLinkPreview url={it.url} />}
              </div>
            </article>
          ))}
        </section>

        {/* Ingeplande bezichtigingen */}
        <section className={`${activeTab==='scheduled' ? '' : 'hidden'} space-y-3`}>
          {scheduledVisible.length === 0 && (
            <div className="rounded-2xl border bg-white p-6 text-center text-slate-600">Geen ingeplande bezichtigingen.</div>
          )}
          {scheduledVisible.map((it) => (
            <article key={`sched-${it.id}`} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="grow">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold">{it.title || "(Geen titel)"}</h3>
                      <span className={badgeClass(it.status)}>{STATUS_OPTIONS.find((s) => s.value === it.status)?.label || it.status}</span>
                      {it.url && <LinkChip url={it.url} />}
                      {Number(it.price) > 0 && (
                        <span className="ml-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{formatEUR(it.price)}</span>
                      )}
                    </div>
                    {it.viewingAt && (
                      <p className="mt-1 text-sm text-slate-700">📅 Bezichtiging: {formatViewing(it.viewingAt)}</p>
                    )}
                    <p className="text-sm text-slate-700">
                      {it.address && <span>{it.address}, </span>}
                      {[it.postalCode, it.city].filter(Boolean).join(" ")}
                      {it.country ? `, ${it.country}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    <a href={buildGoogleMapsUrl(it)} target="_blank" rel="noopener noreferrer" className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50">Google Maps</a>
                    <a href={buildOsmUrl(it)} target="_blank" rel="noopener noreferrer" className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50">OpenStreetMap</a>
                    <button onClick={() => startEdit(it)} className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50">Bewerken</button>
                  </div>
                </div>
                {it.url && <SmartLinkPreview url={it.url} />}
              </div>
            </article>
          ))}
        </section>

        <footer className="mt-10 space-y-1 text-center text-xs text-slate-500">
          <p>Realtime via Firestore (altijd online opslag).</p>
          <p>Build: Firestore Sync · prijs & rich link preview · LinkChip in kopregel · tab bar onderin.</p>
        </footer>
      </div>

      {/* Bottom Tab Bar */}
      <nav className="fixed bottom-0 inset-x-0 border-t bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto max-w-6xl px-4">
          <div className="grid grid-cols-3 text-sm">
            <button onClick={() => setActiveTab('new')} className={`flex flex-col items-center gap-1 py-3 ${activeTab==='new'?'text-slate-900 font-medium':'text-slate-500'}`}>
              <span>➕</span>
              <span>Nieuwe woning</span>
            </button>
            <button onClick={() => setActiveTab('all')} className={`flex flex-col items-center gap-1 py-3 ${activeTab==='all'?'text-slate-900 font-medium':'text-slate-500'}`}>
              <span>📋</span>
              <span>Alle woningen</span>
            </button>
            <button onClick={() => setActiveTab('scheduled')} className={`flex flex-col items-center gap-1 py-3 ${activeTab==='scheduled'?'text-slate-900 font-medium':'text-slate-500'}`}>
              <span>📅</span>
              <span>Ingepland</span>
            </button>
          </div>
        </div>
      </nav>

    </div>
  );
}

// Maps helpers
function buildGoogleMapsUrl(item) {
  const hasCoords = item.lat && item.lng;
  if (hasCoords) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${item.lat},${item.lng}`)}`;
  }
  const q = [item.address, item.postalCode, item.city, item.country].filter(Boolean).join(", ");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}

function buildOsmUrl(item) {
  if (item.lat && item.lng) {
    const coords = `;${item.lat},${item.lng}`;
    return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(coords)}`;
  }
  const q = [item.address, item.postalCode, item.city, item.country].filter(Boolean).join(", ");
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}`;
}
