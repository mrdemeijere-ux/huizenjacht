// Canvas refresh — volledige inhoud opnieuw gesynchroniseerd
import React, { useEffect, useMemo, useState } from "react";

// === Huizenjacht – App (canoniek) ===
// Single-file MVP (React + Tailwind + Firestore realtime sync)
// Altijd online opslag (Firestore, collection boards/global/items)
// Functies:
// - Woning toevoegen/bewerken (titel, link, adres, GPS, makelaar, status, datum/tijd, notities, prijs)
// - Lijsten: Alle woningen, Ingepland, Reviews
// - Inline wijzigen van status en bezichtigingsdatum in lijsten
// - LinkChip + optionele SmartLinkPreview via serverless endpoint
// - Geocoding via serverless /api/geocode → opent altijd OSM met juiste marker
// - Gemiddelde beoordeling als badge in "Alle woningen" en "Ingepland"

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
  runTransaction,
  getDoc,
} from "firebase/firestore";

// 🔧 Gebruik Vercel/Vite env vars indien aanwezig
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
const GEOCODE_ENDPOINT = import.meta?.env?.VITE_GEOCODE_ENDPOINT || "/api/geocode";
const STATUS_OPTIONS = [
  { value: "interessant", label: "Interessant" },
  { value: "afspraak", label: "Afspraak maken" },
  { value: "ingepland", label: "Ingepland voor bezichtiging" },
  { value: "bezichtigd", label: "Bezichtigd" },
  { value: "verkocht", label: "Verkocht" },
];

// ===================== Helpers =====================
function uuid() {
  try { if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID(); } catch {}
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function badgeClass(status) {
  const base = "px-2 py-1 rounded-full text-xs font-medium";
  switch (status) {
    case "interessant": return `${base} bg-blue-100 text-blue-800`;
    case "afspraak": return `${base} bg-amber-100 text-amber-800`;
    case "ingepland": return `${base} bg-purple-100 text-purple-800`;
    case "bezichtigd": return `${base} bg-green-100 text-green-800`;
    case "verkocht": return `${base} bg-zinc-200 text-zinc-800 line-through`;
    default: return `${base} bg-zinc-100 text-slate-800`;
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
    agencyName: "",
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
    return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(value));
  } catch {
    return `€ ${Number(value || 0).toLocaleString("nl-NL")}`;
  }
}

function getUrlParts(u) {
  try {
    const url = new URL(u);
    return { host: url.hostname.replace(/^www\./, ""), path: (url.pathname + url.search).replace(/\/$/, "") || "/" };
  } catch { return { host: u, path: "" }; }
}
function hostInitial(host) { const h = (host || "?").trim(); return (h[0] || "?").toUpperCase(); }

// Compacte link-chip
function LinkChip({ url }) {
  if (!url) return null;
  const parts = getUrlParts(url);
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-[180px] items-center gap-1 rounded-full border px-2 py-0.5 text-xs hover:bg-slate-50" title={url}>
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700">{hostInitial(parts.host)}</span>
      <span className="truncate">{parts.host}</span>
    </a>
  );
}

// Rijke link preview via serverless endpoint (optioneel)
function SmartLinkPreview({ url }) {
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const endpoint = import.meta?.env?.VITE_LINK_PREVIEW_ENDPOINT;
  const parts = getUrlParts(url || "");

  useEffect(() => {
    let alive = true;
    setError(null); setMeta(null);
    if (!endpoint || !url) return;
    setLoading(true);
    const target = `${endpoint}?url=${encodeURIComponent(url)}`;
    fetch(target)
      .then(async (r) => { if (!alive) return; if (!r.ok) { setError(`HTTP ${r.status}`); return; } const data = await r.json().catch(() => null); if (!alive) return; if (data && (data.title || data.image || data.description)) setMeta(data); })
      .catch((e) => alive && setError(e?.message || String(e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [endpoint, url]);

  if (!endpoint || !url) return null;
  if (meta) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="flex gap-3 rounded-xl border bg-white hover:bg-slate-50 transition px-3 py-3">
        {meta.image ? (
          <img src={meta.image} alt="" className="h-16 w-24 rounded-lg object-cover border" />
        ) : (
          <div className="h-16 w-24 rounded-lg bg-slate-100 border flex items-center justify-center text-slate-400 text-xs">{hostInitial(parts.host)}</div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{meta.title || parts.host}</div>
          {meta.description && (<div className="mt-0.5 line-clamp-2 text-xs text-slate-600">{meta.description}</div>)}
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
    <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3 rounded-xl border bg-slate-50 px-3 py-2" title={error ? `Preview niet beschikbaar: ${error}` : url}>
      <div className="flex min-w-0 items-center gap-3">
        <div className="h-6 w-6 rounded-md bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-700">{hostInitial(parts.host)}</div>
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
    <div className="flex items-start gap-2 min-w-0">
      {label && <span className="w-40 sm:w-56 md:w-64 shrink-0 text-sm text-slate-700 leading-snug">{label}</span>}
      <div className="flex items-center flex-shrink-0">
        {stars.map((n) => (
          <button key={n} type="button" aria-label={`${label || "Score"} ${n} ster${n > 1 ? "ren" : ""}`} className={`${cls} leading-none px-0.5`} onClick={() => onChange?.(n)} onKeyDown={(e) => { if (e.key === "ArrowRight") onChange?.(Math.min(5, (value || 0) + 1)); if (e.key === "ArrowLeft") onChange?.(Math.max(1, (value || 0) - 1)); }}>
            <span className={n <= (value || 0) ? "" : "opacity-30"}>★</span>
          </button>
        ))}
      </div>
      {value ? (<span className="text-xs text-slate-600">{value}/5</span>) : (<span className="text-xs text-slate-400">–</span>)}
      {hint && <span className="ml-2 text-[11px] text-slate-500">{hint}</span>}
    </div>
  );
}

function averageRating(r) {
  if (!r) return 0;
  const vals = Object.values(r).filter((v) => Number(v) > 0);
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

function formatViewing(dt) {
  if (!dt) return "";
  try {
    const asDate = new Date(dt);
    if (!isNaN(asDate)) return asDate.toLocaleString();
    return dt;
  } catch { return dt; }
}

// --- OSM helpers (altijd endpoint gebruiken) ---
function makeOsmUrl(lat, lng, zoom = 12) {
  const la = Number(lat), lo = Number(lng);
  if (!isFinite(la) || !isFinite(lo)) return "https://www.openstreetmap.org";
  return `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=${zoom}/${la}/${lo}`;
}

// Geocodeer ALTIJD via serverless endpoint, sla op, en open daarna OSM
async function openOsmApprox(it, updateItem) {
  try {
    const qs = new URLSearchParams({
      url: it.url || "",
      address: it.address || "",
      city: it.city || "",
      postalCode: it.postalCode || "",
      country: it.country || "France",
      // debug: "1",
    });
    const r = await fetch(`${GEOCODE_ENDPOINT}?${qs.toString()}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || r.statusText);
    const { lat, lng } = data;
    if (it.id) await updateItem(it.id, { lat, lng });
    window.open(makeOsmUrl(lat, lng), "_blank", "noopener");
  } catch (e) { alert(`Geocoden mislukt: ${e?.message || e}`); }
}

// ===================== App =====================
export default function App() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState("createdDesc");
  const [errors, setErrors] = useState({});
  const [activeTab, setActiveTab] = useState("all");
const [myVotes, setMyVotes] = useState({}); // { [itemId]: 1 | -1 | 0 }

  const [user, setUser] = useState(null);
  const boardId = "global";
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

  // Firestore subscription
  useEffect(() => {
    if (!user) return;
    setDoc(doc(db, "boards", boardId), { createdAt: serverTimestamp() }, { merge: true }).catch(() => {});
    const qRef = query(collection(db, "boards", boardId, "items"), orderBy("order", "desc"));
    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const list = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
        setItems(list); setLiveStatus("online"); setSyncError(null);
      },
      (err) => { console.error("onSnapshot error", err); setLiveStatus("error"); setSyncError(err); }
    );
    return () => { setLiveStatus("offline"); unsub(); };
  }, [user]);

  // Haal mijn stemmen op zodra items of user wijzigen
  useEffect(() => {
    if (!user || items.length === 0) {
      setMyVotes({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const entries = await Promise.all(
          items.map(async (it) => {
            try {
              const vSnap = await getDoc(doc(db, "boards", boardId, "items", it.id, "votes", user.uid));
              return [it.id, vSnap.exists() ? (vSnap.data().v || 0) : 0];
            } catch {
              return [it.id, 0];
            }
          })
        );
        if (!cancelled) setMyVotes(Object.fromEntries(entries));
      } catch {
        /* noop */
      }
    })();
    return () => { cancelled = true; };
  }, [user, items]);

  function resetForm() { setForm(emptyForm()); setErrors({}); }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate(form); setErrors(errs);
    if (Object.keys(errs).length) return;
    const { id: _drop, ...payload } = form;
    const withMeta = { ...payload, createdAt: serverTimestamp(), order: Date.now() };
    try { await addDoc(collection(db, "boards", boardId, "items"), withMeta); resetForm(); setActiveTab("all"); }
    catch (err) { alert("Opslaan in Firestore mislukt: " + (err?.message || String(err))); }
  }

  function startEdit(it) { setEditingId(it.id); setForm({ ...it }); setActiveTab("new"); }

  async function saveEdit() {
    const errs = validate(form); setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      const { id: _ignore, ...payload } = form;
      await updateDoc(doc(db, "boards", boardId, "items", editingId), payload);
      setEditingId(null); resetForm(); setActiveTab("all");
    } catch (err) { alert("Bijwerken mislukt: " + (err?.message || String(err))); }
  }

  function cancelEdit() { setEditingId(null); resetForm(); }

  async function remove(id) {
    if (!confirm("Weet je zeker dat je deze woning wilt verwijderen?")) return;
    try { await deleteDoc(doc(db, "boards", boardId, "items", id)); }
    catch (err) { alert("Verwijderen mislukt: " + (err?.message || String(err))); }
  }

  async function move(id, dir) {
    const idx = items.findIndex((p) => p.id === id); if (idx < 0) return;
    const swapWith = dir === "up" ? idx - 1 : idx + 1; if (swapWith < 0 || swapWith >= items.length) return;
    try {
      const a = items[idx]; const b = items[swapWith];
      await Promise.all([
        updateDoc(doc(db, "boards", boardId, "items", a.id), { order: b.order || 0 }),
        updateDoc(doc(db, "boards", boardId, "items", b.id), { order: a.order || 0 }),
      ]);
    } catch (err) { alert("Volgorde wijzigen mislukt: " + (err?.message || String(err))); }
  }

  async function updateItem(id, patch) {
    try { await updateDoc(doc(db, "boards", boardId, "items", id), patch); }
    catch (err) { alert("Opslaan mislukt: " + (err?.message || String(err))); }
  }

  async function updateRating(id, key, val) {
    const it = items.find((x) => x.id === id);
    const current = it?.ratings || defaultRatings();
    const patch = { ratings: { ...current, [key]: val } };
    await updateItem(id, patch);
  }

  // Stemmen (like/dislike) met transacties en per-user vote document
  async function castVote(itemId, value /* 1 = like, -1 = dislike */) {
    if (!user) return;
    const itemRef = doc(db, "boards", boardId, "items", itemId);
    const voteRef = doc(db, "boards", boardId, "items", itemId, "votes", user.uid);

    try {
      await runTransaction(db, async (tx) => {
        const itemSnap = await tx.get(itemRef);
        if (!itemSnap.exists()) throw new Error("Item bestaat niet meer");

        const data = itemSnap.data() || {};
        let likes = Number(data.likes) || 0;
        let dislikes = Number(data.dislikes) || 0;

        const voteSnap = await tx.get(voteRef);
        const prev = voteSnap.exists() ? (voteSnap.data().v || 0) : 0;

        if (value === prev) {
          if (prev === 1) likes--;
          if (prev === -1) dislikes--;
          tx.delete(voteRef);
        } else {
          if (prev === 1) likes--;
          if (prev === -1) dislikes--;
          if (value === 1) likes++;
          if (value === -1) dislikes++;
          tx.set(voteRef, { v: value, at: serverTimestamp() });
        }
        tx.update(itemRef, { likes, dislikes });
      });

      setMyVotes((m) => {
        const prev = m[itemId] || 0;
        return { ...m, [itemId]: value === prev ? 0 : value };
      });
    } catch (err) {
      alert("Stemmen mislukt: " + (err?.message || String(err)));
    }
  }

  const visible = useMemo(() => {
    let v = [...items];
    if (filter.trim()) {
      const q = filter.toLowerCase();
      v = v.filter((it) => [
        it.title, it.address, it.city, it.postalCode, it.country,
        it.agencyName, it.agentName, it.agentEmail, it.agentPhone, it.notes,
        it.price != null ? String(it.price) : "",
      ].filter(Boolean).join(" ").toLowerCase().includes(q));
    }
    if (statusFilter) v = v.filter((it) => it.status === statusFilter);
    if (sortBy === "createdDesc") v.sort((a, b) => (b.order || 0) - (a.order || 0));
    if (sortBy === "cityAsc") v.sort((a, b) => (a.city || "").localeCompare(b.city || ""));
    if (sortBy === "statusAsc") v.sort((a, b) => (a.status || "").localeCompare(b.status || ""));
    if (sortBy === "priceAsc") v.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
    if (sortBy === "priceDesc") v.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
    return v;
  }, [items, filter, statusFilter, sortBy]);

  const scheduledVisible = useMemo(() => items.filter((it) => it.viewingAt).slice().sort((a, b) => new Date(a.viewingAt) - new Date(b.viewingAt)), [items]);

  const isEditing = Boolean(editingId);

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
            <div className="mt-1"><code className="rounded bg-white/60 px-1">{syncError.code || "unknown"}</code> · {syncError.message || String(syncError)}</div>
          </div>
        )}

        {/* Tabs boven-form */}
        <nav className="mb-4 flex gap-2 text-sm">
          <button onClick={() => setActiveTab("new")} className={`rounded-xl border px-3 py-2 ${activeTab==='new' ? 'bg-slate-900 text-white' : 'bg-white'}`}>Nieuwe woning</button>
          <button onClick={() => setActiveTab("all")} className={`rounded-xl border px-3 py-2 ${activeTab==='all' ? 'bg-slate-900 text-white' : 'bg-white'}`}>Alle woningen</button>
          <button onClick={() => setActiveTab("scheduled")} className={`rounded-xl border px-3 py-2 ${activeTab==='scheduled' ? 'bg-slate-900 text-white' : 'bg-white'}`}>Ingepland</button>
          <button onClick={() => setActiveTab("reviews")} className={`rounded-xl border px-3 py-2 ${activeTab==='reviews' ? 'bg-slate-900 text-white' : 'bg-white'}`}>Reviews</button>
        </nav>

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
                <label className="text-sm font-medium">Makelaar e-mail</label>
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
                {STATUS_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
              </select>
              {errors.status && <p className="text-xs text-rose-600">{errors.status}</p>}
            </div>

            <div>
              <label className="text-sm font-medium">Notities</label>
              <textarea className="mt-1 w-full rounded-xl border px-3 py-2" rows={2} placeholder="Parkeren bij achteringang, sleutel ophalen bij buur..." value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>

            <div className="md:col-span-2 flex items-center gap-2 pt-2">
              {!isEditing && (<button className="rounded-2xl bg-slate-900 px-4 py-2 text-white shadow hover:opacity-90" type="submit">Toevoegen</button>)}
              {isEditing && (<>
                <button className="rounded-2xl bg-slate-900 px-4 py-2 text-white shadow hover:opacity-90" type="button" onClick={saveEdit}>Opslaan</button>
                <button className="rounded-2xl border px-4 py-2 shadow-sm" type="button" onClick={cancelEdit}>Annuleren</button>
              </>)}
              <button type="button" className="ml-auto rounded-2xl border px-3 py-2 text-sm shadow-sm" onClick={resetForm}>Formulier leegmaken</button>
            </div>
          </form>
        </section>

        {/* Filters/Sortering */}
        <section className={`${activeTab==='all' ? '' : 'hidden'} mb-3`}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input className="w-full min-w-0 rounded-xl border px-3 py-2" placeholder="Zoek op adres, plaats, makelaar..." value={filter} onChange={(e) => setFilter(e.target.value)} />
            <select className="w-full min-w-0 rounded-xl border px-3 py-2" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Alle statussen</option>
              {STATUS_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
            <div className="w-full min-w-0">
              <label className="sr-only">Sorteren</label>
              <select className="w-full rounded-xl border px-3 py-2" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="createdDesc">Nieuwste eerst</option>
                <option value="cityAsc">Plaats A→Z</option>
                <option value="statusAsc">Status A→Z</option>
                <option value="priceAsc">Prijs laag → hoog</option>
                <option value="priceDesc">Prijs hoog → laag</option>
              </select>
            </div>
          </div>
        </section>

        {/* Lijst: Alle woningen */}
        <section className={`space-y-3 ${activeTab==='all' ? '' : 'hidden'}`}>
          {visible.length === 0 && (<div className="rounded-2xl border bg-white p-6 text-center text-slate-600">Nog geen woningen opgeslagen.</div>)}
          {visible.map((it, idx) => (
            <article key={it.id} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-[1fr,auto]">
                  <div className="grow">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <h3 className="text-lg font-semibold">{it.title || "(Geen titel)"}</h3>
                      <span className={badgeClass(it.status)}>{STATUS_OPTIONS.find((s) => s.value === it.status)?.label || it.status}</span>
                      {it.url && <LinkChip url={it.url} />}
                      {Number(it.price) > 0 && (<span className="ml-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{formatEUR(it.price)}</span>)}
                      {averageRating(it.ratings) > 0 && (<span className="ml-1 rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-amber-700">⭐ {averageRating(it.ratings)}/5</span>)}
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

                    {/* Inline wijzigen */}
                    <div className="mt-2 flex flex-wrap items-center gap-2 min-w-0">
                      <label className="text-xs text-slate-600">Status</label>
                      <select className="rounded-lg border px-2 py-1 text-xs" value={it.status} onChange={(e) => updateItem(it.id, { status: e.target.value })}>
                        {STATUS_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                      </select>
                      <label className="ml-2 text-xs text-slate-600">Bezichtiging</label>
                      <input type="datetime-local" className="rounded-lg border px-2 py-1 text-xs w-full sm:w-auto min-w-0 max-w-full appearance-none" value={it.viewingAt || ""} onChange={(e) => updateItem(it.id, { viewingAt: e.target.value })} />
                      {it.viewingAt && (<span className="text-xs text-slate-600">({formatViewing(it.viewingAt)})</span>)}
                    </div>
                    {it.notes && <p className="mt-2 text-sm text-slate-600">🗒️ {it.notes}</p>}
                  </div>

                  <div className="flex flex-wrap sm:flex-nowrap items-start justify-start sm:justify-end gap-2 self-start shrink-0 min-w-max whitespace-nowrap">
                    <button onClick={() => openOsmApprox(it, updateItem)} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M9 3.5L3.5 5v15L9 18.5l6 2.5 5.5-1.5v-15L15 5.5 9 3.5zm6 3.31l3-.82v12.02l-3 .82V6.81zM8 5.19l5 2.08v12.54l-5-2.08V5.19zM5 6.06l2-.55v12.52l-2 .55V6.06z"/></svg>
                      Toon op OSM
                    </button>
                    <button onClick={() => startEdit(it)} className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50">Bewerken</button>
                    <button onClick={() => remove(it.id)} className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-rose-50">Verwijderen</button>
                    <button onClick={() => move(it.id, "up")} disabled={idx === 0} className="rounded-xl border px-3 py-2 text-sm shadow-sm disabled:opacity-40">↑</button>
                    <button onClick={() => move(it.id, "down")} disabled={idx === visible.length - 1} className="rounded-xl border px-3 py-2 text-sm shadow-sm disabled:opacity-40">↓</button>
                  </div>
                </div>
                {it.url && <SmartLinkPreview url={it.url} />}

                {/* Likes / Dislikes */}
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => castVote(it.id, 1)}
                    aria-pressed={myVotes[it.id] === 1}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-sm transition ${myVotes[it.id] === 1 ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "hover:bg-slate-50"}`}
                    title="Vind ik leuk"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M2 10h4v10H2V10Zm6.3 10h7.36a3 3 0 0 0 2.94-2.43l1.03-5.67A3 3 0 0 0 16.69 8H13V6a3 3 0 0 0-3-3h-.5a1 1 0 0 0-1 1.2l.7 3.5A2 2 0 0 1 8.25 9L8 10.5V20.5c.08.32.33.5.3.5Z"/>
                    </svg>
                    <span>{Number(it.likes) || 0}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => castVote(it.id, -1)}
                    aria-pressed={myVotes[it.id] === -1}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-sm transition ${myVotes[it.id] === -1 ? "bg-rose-50 border-rose-200 text-rose-700" : "hover:bg-slate-50"}`}
                    title="Vind ik niet leuk"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M2 4h4v10H2V4Zm6.3-2h7.36A3 3 0 0 1 18.6 4.43l1.03 5.67A3 3 0 0 1 16.69 14H13v2a3 3 0 0 1-3 3h-.5a1 1 0 0 1-1-1.2l.7-3.5A2 2 0 0 0 8.25 12L8 10.5V1.5c.08-.32.33-.5.3-.5Z"/>
                    </svg>
                    <span>{Number(it.dislikes) || 0}</span>
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>

        {/* Ingeplande bezichtigingen */}
        <section className={`${activeTab==='scheduled' ? '' : 'hidden'} space-y-3`}>
          {scheduledVisible.length === 0 && (<div className="rounded-2xl border bg-white p-6 text-center text-slate-600">Geen ingeplande bezichtigingen.</div>)}
          {scheduledVisible.map((it) => (
            <article key={`sched-${it.id}`} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-[1fr,auto]">
                  <div className="grow">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold">{it.title || "(Geen titel)"}</h3>
                      <span className={badgeClass(it.status)}>{STATUS_OPTIONS.find((s) => s.value === it.status)?.label || it.status}</span>
                      {it.url && <LinkChip url={it.url} />}
                      {Number(it.price) > 0 && (<span className="ml-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{formatEUR(it.price)}</span>)}
                      {averageRating(it.ratings) > 0 && (<span className="ml-1 rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-amber-700">⭐ {averageRating(it.ratings)}/5</span>)}
                    </div>
                    {it.viewingAt && (<p className="mt-1 text-sm text-slate-700">📅 Bezichtiging: {formatViewing(it.viewingAt)}</p>)}
                    <p className="text-sm text-slate-700">
                      {it.address && <span>{it.address}, </span>}
                      {[it.postalCode, it.city].filter(Boolean).join(" ")}
                      {it.country ? `, ${it.country}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap sm:flex-nowrap items-start justify-start sm:justify-end gap-2 self-start shrink-0 min-w-max whitespace-nowrap">
                    <button onClick={() => openOsmApprox(it, updateItem)} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M9 3.5L3.5 5v15L9 18.5l6 2.5 5.5-1.5v-15L15 5.5 9 3.5zm6 3.31l3-.82v12.02l-3 .82V6.81zM8 5.19l5 2.08v12.54l-5-2.08V5.19zM5 6.06l2-.55v12.52l-2 .55V6.06z"/></svg>
                      Toon op OSM
                    </button>
                    <button onClick={() => startEdit(it)} className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50">Bewerken</button>
                  </div>
                </div>
                {it.url && <SmartLinkPreview url={it.url} />}

                {/* Likes / Dislikes */}
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => castVote(it.id, 1)}
                    aria-pressed={myVotes[it.id] === 1}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-sm transition ${myVotes[it.id] === 1 ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "hover:bg-slate-50"}`}
                    title="Vind ik leuk"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M2 10h4v10H2V10Zm6.3 10h7.36a3 3 0 0 0 2.94-2.43l1.03-5.67A3 3 0 0 0 16.69 8H13V6a3 3 0 0 0-3-3h-.5a1 1 0 0 0-1 1.2l.7 3.5A2 2 0 0 1 8.25 9L8 10.5V20.5c.08.32.33.5.3.5Z"/>
                    </svg>
                    <span>{Number(it.likes) || 0}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => castVote(it.id, -1)}
                    aria-pressed={myVotes[it.id] === -1}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-sm transition ${myVotes[it.id] === -1 ? "bg-rose-50 border-rose-200 text-rose-700" : "hover:bg-slate-50"}`}
                    title="Vind ik niet leuk"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M2 4h4v10H2V4Zm6.3-2h7.36A3 3 0 0 1 18.6 4.43l1.03 5.67A3 3 0 0 1 16.69 14H13v2a3 3 0 0 1-3 3h-.5a1 1 0 0 1-1-1.2l.7-3.5A2 2 0 0 0 8.25 12L8 10.5V1.5c.08-.32.33-.5.3-.5Z"/>
                    </svg>
                    <span>{Number(it.dislikes) || 0}</span>
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>

        {/* Reviews Tab */}
        <section className={`${activeTab==='reviews' ? '' : 'hidden'} space-y-3`}>
          {items.length === 0 && (<div className="rounded-2xl border bg-white p-6 text-center text-slate-600">Nog geen woningen om te beoordelen.</div>)}
          {items.map((it) => (
            <article key={`rev-${it.id}`} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-[1fr,auto]">
                  <div className="grow">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <h3 className="text-lg font-semibold">{it.title || "(Geen titel)"}</h3>
                      <span className={badgeClass(it.status)}>{STATUS_OPTIONS.find((s) => s.value === it.status)?.label || it.status}</span>
                      {it.url && <LinkChip url={it.url} />}
                      {Number(it.price) > 0 && (<span className="ml-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{formatEUR(it.price)}</span>)}
                      {averageRating(it.ratings) > 0 && (<span className="ml-2 rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-amber-700">⭐ {averageRating(it.ratings)}/5</span>)}
                    </div>
                    <p className="text-sm text-slate-700">
                      {it.address && <span>{it.address}, </span>}
                      {[it.postalCode, it.city].filter(Boolean).join(" ")}
                      {it.country ? `, ${it.country}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap sm:flex-nowrap items-start justify-start sm:justify-end gap-2 self-start shrink-0 min-w-max whitespace-nowrap">
                    <button onClick={() => startEdit(it)} className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50">Bewerken</button>
                    <button type="button" onClick={async () => {
                      try {
                        await updateDoc(doc(db, "boards", boardId, "items", it.id), {
                          "ratings.overall": 0,
                          "ratings.location": 0,
                          "ratings.accessibility": 0,
                          "ratings.business": 0,
                          "ratings.renovation": 0,
                          "ratings.parking": 0,
                          "ratings.pool": 0,
                          "ratings.privateAreas": 0,
                          "ratings.feasibility": 0,
                        });
                      } catch (err) { alert("Reset mislukt: " + (err?.message || String(err))); }
                    }} className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-white">Reset sterren</button>
                  </div>
                </div>

                {/* Volledige beoordeling invullen */}
                <div className="rounded-xl border bg-slate-50 p-3">
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
                  {it.status !== "bezichtigd" && (<p className="mt-2 text-xs text-slate-500">Tip: markeer de woning als "Bezichtigd" zodra je de beoordeling invult.</p>)}
                </div>
              </div>
            </article>
          ))}
        </section>
      </div>

      {/* Onderste tabbar (mobielvriendelijk) */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-6xl grid grid-cols-3">
          <button onClick={() => setActiveTab("new")} className={`py-3 text-sm ${activeTab==='new' ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>Nieuwe woning</button>
          <button onClick={() => setActiveTab("all")} className={`py-3 text-sm ${activeTab==='all' ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>Alle woningen</button>
          <button onClick={() => setActiveTab("scheduled")} className={`py-3 text-sm ${activeTab==='scheduled' ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>Ingepland</button>
        </div>
      </nav>
    </div>
  );
}
