import React, { useEffect, useMemo, useState } from "react";

// Huizenjacht – single-file MVP (React + Tailwind + Firestore realtime sync)
// New in this version:
// - Firebase Auth (anonymous) + Firestore realtime sync per "Board"
// - Create/Join board, copy invite link, live multi-device updates
// - Offline support via Firestore IndexedDB persistence
// - Backward compatible: if no board selected, localStorage works as before
//
// How to enable Firebase:
// 1) Create a Firebase project, enable Authentication (Anonymous) and Firestore.
// 2) Add your web app and paste config below.
// 3) In Firebase Auth → Settings → Authorized domains: add your Vercel domain.
// 4) Suggested Firestore rules (minimal):
//    rules_version = '2';
//    service cloud.firestore { match /databases/{database}/documents { 
//      match /boards/{boardId} {
//        allow read, write: if request.auth != null; // anonymous users okay
//        match /items/{itemId} { allow read, write: if request.auth != null; }
//      }
//    }}

// ===================== Firebase setup =====================
import { initializeApp } from "firebase/app";
import {
  getFirestore,
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
  writeBatch,
  enableIndexedDbPersistence,
} from "firebase/firestore";
import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";

// 🔧 REPLACE with your own Firebase config
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Enable offline persistence
enableIndexedDbPersistence(db).catch((e) => {
  console.warn("IndexedDB persistence not enabled:", e?.code || e);
});

// ===================== App state & helpers =====================
const STORAGE_KEY = "huizenjacht_v1";
const BOARD_KEY = "huizenjacht_board_id";

// Safe UUID helper for older browsers
function uuid() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

const STATUS_OPTIONS = [
  { value: "interessant", label: "Interessant" },
  { value: "afspraak", label: "Afspraak maken" },
  { value: "ingepland", label: "Ingepland voor bezichtiging" },
  { value: "bezichtigd", label: "Bezichtigd" },
  { value: "verkocht", label: "Verkocht" },
];

function useLocalStorageState(initialValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
      return raw ? JSON.parse(raw) : initialValue;
    } catch (e) {
      console.error("Failed to parse storage", e);
      return initialValue;
    }
  });
  useEffect(() => {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
    } catch (e) {
      console.error("Failed to write storage", e);
    }
  }, [state]);
  return [state, setState];
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
      return `${base} bg-zinc-100 text-zinc-800`;
  }
}

function defaultRatings() {
  return {
    overall: 0,
    location: 0,
    accessibility: 0,
    business: 0,
    renovation: 0,
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
    ratings: defaultRatings(),
  };
}

function buildGoogleMapsUrl(item) {
  const hasCoords = item.lat && item.lng;
  if (hasCoords) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
      `${item.lat},${item.lng}`
    )}`;
  }
  const q = [item.address, item.postalCode, item.city, item.country]
    .filter(Boolean)
    .join(", ");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}

function buildOsmUrl(item) {
  if (item.lat && item.lng) {
    return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(
      `;${item.lat},${item.lng}`
    )}`;
  }
  const q = [item.address, item.postalCode, item.city, item.country]
    .filter(Boolean)
    .join(", ");
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}`;
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

function getUrlParts(u) {
  try {
    const url = new URL(u);
    return {
      host: url.hostname.replace(/^www\./, ""),
      path: (url.pathname + url.search).replace(/\/$/, "") || "/",
    };
  } catch {
    return { host: u, path: "" };
  }
}

function hostInitial(host) {
  const h = (host || "?").trim();
  return (h[0] || "?").toUpperCase();
}

function LinkPreview({ url }) {
  if (!url) return null;
  const parts = getUrlParts(url);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); } catch {}
  };
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border bg-slate-50 px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-300 text-[10px] font-bold text-slate-800">
          {hostInitial(parts.host)}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{parts.host}</div>
          <div className="truncate text-xs text-slate-600">{parts.path}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-lg border px-2 py-1 text-xs hover:bg-white">Open</a>
        <button onClick={copy} className="rounded-lg border px-2 py-1 text-xs hover:bg-white">Kopieer</button>
      </div>
    </div>
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
            aria-label={`${label || "Score"} ${n} ster${n>1?"ren":""}`}
            className={`${cls} leading-none px-0.5`}
            onClick={() => onChange?.(n)}
            onKeyDown={(e)=>{ if(e.key==='ArrowRight') onChange?.(Math.min(5,(value||0)+1)); if(e.key==='ArrowLeft') onChange?.(Math.max(1,(value||0)-1)); }}
          >
            <span className={n <= (value || 0) ? "" : "opacity-30"}>★</span>
          </button>
        ))}
      </div>
      {value ? <span className="text-xs text-slate-600">{value}/5</span> : <span className="text-xs text-slate-400">–</span>}
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

function TopStatusBar({ boardId, liveStatus }) {
  return (
    <div className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto max-w-6xl px-6 py-2 text-xs text-slate-700 flex items-center justify-between">
        <div>
          {boardId ? (
            <>
              ⚡ Sync: <span className="font-medium">{liveStatus}</span> · Board: <code className="px-1 rounded bg-slate-100">{boardId}</code>
            </>
          ) : (
            <>
              ⚠️ Je werkt lokaal — <span className="font-medium">geen sync</span>. Maak of join een board om te delen.
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [items, setItems] = useLocalStorageState([]); // used when no board selected
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState("createdDesc");
  const [errors, setErrors] = useState({});

  // Firebase auth
  const [user, setUser] = useState(null);
  const [boardId, setBoardId] = useState(() => {
    const urlBoard = new URLSearchParams(window.location.search).get("board");
    return urlBoard || localStorage.getItem(BOARD_KEY) || "";
  });
  const [liveStatus, setLiveStatus] = useState("offline");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      if (!u) signInAnonymously(auth).catch((e) => console.error("anon auth failed", e));
    });
    return () => unsub();
  }, []);

  // Subscribe to Firestore when a board is selected
  useEffect(() => {
    if (!boardId || !user) return;
    localStorage.setItem(BOARD_KEY, boardId);

    // Ensure board doc exists
    setDoc(doc(db, "boards", boardId), { createdAt: serverTimestamp() }, { merge: true }).catch(()=>{});

    const qRef = query(collection(db, "boards", boardId, "items"), orderBy("order", "desc"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(qRef, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setItems(list);
      setLiveStatus("online");
    }, (err) => {
      console.error("onSnapshot error", err);
      setLiveStatus("error");
    });
    return () => { setLiveStatus("offline"); unsub(); };
  }, [boardId, user]);

  // Ensure legacy items have id (local mode only)
  useEffect(() => {
    if (boardId) return; // skip when using Firestore
    const fixed = items.map((it) => (it.id ? it : { ...it, id: uuid() }));
    if (JSON.stringify(fixed) !== JSON.stringify(items)) setItems(fixed);
  }, []);

  function resetForm() {
    setForm(emptyForm());
    setErrors({});
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const withMeta = { ...form, createdAt: Date.now(), order: Date.now() };
    if (!boardId) {
      setItems((prev) => [withMeta, ...prev]);
      resetForm();
      return;
    }
    try {
      await addDoc(collection(db, "boards", boardId, "items"), {
        ...withMeta,
        createdAt: serverTimestamp(),
      });
      resetForm();
    } catch (err) {
      alert("Opslaan in Firestore mislukt: " + (err?.message || String(err)));
    }
  }

  function startEdit(it) {
    setEditingId(it.id);
    setForm({ ...it });
  }

  async function saveEdit() {
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;

    if (!boardId) {
      setItems((prev) => prev.map((p) => (p.id === editingId ? { ...p, ...form } : p)));
      setEditingId(null);
      resetForm();
      return;
    }
    try {
      await updateDoc(doc(db, "boards", boardId, "items", editingId), { ...form });
      setEditingId(null);
      resetForm();
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
    if (!boardId) {
      setItems((prev) => prev.filter((p) => p.id !== id));
      if (editingId === id) cancelEdit();
      return;
    }
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

    if (!boardId) {
      const next = [...items];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      setItems(next);
      return;
    }
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
    if (!boardId) {
      setItems((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      return;
    }
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

  function exportJson() {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `huizenjacht_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(String(e.target?.result || "[]"));
        if (!Array.isArray(data)) throw new Error("Bestand bevat geen lijst");
        if (!boardId) {
          const normalized = data.map((d) => ({ id: d.id || uuid(), ...d }));
          setItems(normalized);
          return;
        }
        const batch = writeBatch(db);
        const colRef = collection(db, "boards", boardId, "items");
        data.forEach((d) => {
          const ref = doc(colRef);
          batch.set(ref, { ...d, createdAt: serverTimestamp(), order: d.order || Date.now() });
        });
        await batch.commit();
      } catch (err) {
        alert("Import mislukt: " + (err?.message || String(err)));
      }
    };
    reader.readAsText(file);
  }

  function copyBoardLink() {
    if (!boardId) return alert("Geen board actief. Maak of join eerst een board.");
    const url = `${window.location.origin}${window.location.pathname}?board=${encodeURIComponent(boardId)}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => alert("Board-link gekopieerd"));
    } else {
      prompt("Kopieer deze link:", url);
    }
  }

  async function createBoard() {
    const newId = uuid().replace(/[^a-zA-Z0-9_-]/g, "");
    try {
      await setDoc(doc(db, "boards", newId), { createdAt: serverTimestamp() });
      setBoardId(newId);
      localStorage.setItem(BOARD_KEY, newId);
      // Migrate local items (if any)
      if (items && items.length) {
        const batch = writeBatch(db);
        const colRef = collection(db, "boards", newId, "items");
        items.forEach((d) => {
          const ref = doc(colRef);
          batch.set(ref, { ...d, createdAt: serverTimestamp(), order: d.order || Date.now() });
        });
        await batch.commit();
      }
      alert("Board aangemaakt en (eventueel) lokale items gemigreerd.");
    } catch (e) {
      alert("Board maken faalde: " + (e?.message || String(e)));
    }
  }

  function joinBoardPrompt() {
    const id = prompt("Voer Board ID in (van gedeelde link)", "");
    if (!id) return;
    setBoardId(id.trim());
    localStorage.setItem(BOARD_KEY, id.trim());
  }

  const visible = useMemo(() => {
    let v = [...items];
    if (filter.trim()) {
      const q = filter.toLowerCase();
      v = v.filter((it) =>
        [it.title, it.address, it.city, it.postalCode, it.country, it.agencyName, it.agentName, it.agentEmail, it.agentPhone, it.notes]
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
    return v;
  }, [items, filter, statusFilter, sortBy]);

  const isEditing = Boolean(editingId);

  function formatViewing(dt) {
    if (!dt) return "";
    try { const asDate = new Date(dt); if (!isNaN(asDate)) return asDate.toLocaleString(); return dt; } catch { return dt; }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900">
      <TopStatusBar boardId={boardId} liveStatus={liveStatus} />
      <div className="mx-auto max-w-6xl p-6">
        <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Huizenjacht – MVP</h1>
            <p className="text-sm text-slate-600">Beheer je bezichtigingen, makelaars en routes. Nu met realtime sync per board.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span>Sync status: {liveStatus}</span>
              {boardId && <span className="rounded-full bg-slate-100 px-2 py-0.5">Board: {boardId}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-sm">
              <span>Importeer JSON</span>
              <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
            </label>
            <button onClick={exportJson} className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50">Exporteer JSON</button>
            <button onClick={copyBoardLink} className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50">Kopieer board-link</button>
          </div>
        </header>

        {/* Board controls */}
        <section className="mb-4 flex flex-wrap items-center gap-2">
          {!boardId && (
            <>
              <button onClick={createBoard} className="rounded-2xl bg-slate-900 px-4 py-2 text-white shadow hover:opacity-90">Nieuw board</button>
              <button onClick={joinBoardPrompt} className="rounded-2xl border px-4 py-2 shadow-sm">Board joinen</button>
              <span className="text-sm text-slate-600">(zonder board werk je lokaal op dit apparaat)</span>
            </>
          )}
          {boardId && (
            <>
              <button onClick={()=>{localStorage.removeItem(BOARD_KEY); setBoardId("");}} className="rounded-2xl border px-4 py-2 shadow-sm">Board verlaten</button>
              <button onClick={copyBoardLink} className="rounded-2xl border px-4 py-2 shadow-sm">Deel invite-link</button>
            </>
          )}
        </section>

        {!boardId && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="font-medium">Je werkt nu lokaal (alleen dit apparaat).</div>
            <div>Gebruik <span className="font-semibold">Nieuw board</span> of <span className="font-semibold">Board joinen</span> om te synchroniseren met andere apparaten.</div>
          </div>
        )}

        {/* Form */}
        <section className="mb-8 rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">{isEditing ? "Woning bewerken" : "Nieuwe woning toevoegen"}</h2>
          <form onSubmit={isEditing ? (e)=>{e.preventDefault(); saveEdit();} : handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Titel / Naam woning<span className="text-rose-600">*</span></label>
              <input className={`mt-1 w-full rounded-xl border px-3 py-2 ${errors.title?"border-rose-400":''}`} placeholder="Bijv. Charmehuisje bij Dijon" value={form.title} onChange={(e)=>setForm({...form, title:e.target.value})} />
              {errors.title && <p className="text-xs text-rose-600">{errors.title}</p>}
            </div>
            <div>
              <label className="text-sm font-medium">Link naar woning<span className="text-rose-600">*</span></label>
              <input className={`mt-1 w-full rounded-xl border px-3 py-2 ${errors.url?"border-rose-400":''}`} placeholder="https://..." value={form.url} onChange={(e)=>setForm({...form, url:e.target.value})} />
              {errors.url && <p className="text-xs text-rose-600">{errors.url}</p>}
            </div>

            <div className="md:col-span-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-sm font-medium">Adres<span className="text-rose-600">*</span></label>
                <input className={`mt-1 w-full rounded-xl border px-3 py-2 ${errors.address?"border-rose-400":''}`} placeholder="Rue de ... 12" value={form.address} onChange={(e)=>setForm({...form, address:e.target.value})} />
                {errors.address && <p className="text-xs text-rose-600">{errors.address}</p>}
              </div>
              <div>
                <label className="text-sm font-medium">Postcode<span className="text-rose-600 opacity-0">*</span></label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" placeholder="75001" value={form.postalCode} onChange={(e)=>setForm({...form, postalCode:e.target.value})} />
              </div>
              <div>
                <label className="text-sm font-medium">Plaats<span className="text-rose-600">*</span></label>
                <input className={`mt-1 w-full rounded-xl border px-3 py-2 ${errors.city?"border-rose-400":''}`} placeholder="Paris" value={form.city} onChange={(e)=>setForm({...form, city:e.target.value})} />
                {errors.city && <p className="text-xs text-rose-600">{errors.city}</p>}
              </div>
              <div>
                <label className="text-sm font-medium">Land</label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" value={form.country} onChange={(e)=>setForm({...form, country:e.target.value})} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium">GPS Latitude (opt.)</label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" placeholder="48.8566" value={form.lat} onChange={(e)=>setForm({...form, lat:e.target.value})} />
              </div>
              <div>
                <label className="text-sm font-medium">GPS Longitude (opt.)</label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" placeholder="2.3522" value={form.lng} onChange={(e)=>setForm({...form, lng:e.target.value})} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 md:col-span-2">
              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Makelaardij</label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" placeholder="Agence BelleMaison" value={form.agencyName} onChange={(e)=>setForm({...form, agencyName:e.target.value})} />
              </div>
              <div>
                <label className="text-sm font-medium">Makelaar naam</label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" placeholder="Mme Dupont" value={form.agentName} onChange={(e)=>setForm({...form, agentName:e.target.value})} />
              </div>
              <div>
                <label className="text-sm font-medium">Makelaar telefoon</label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" placeholder="+33 ..." value={form.agentPhone} onChange={(e)=>setForm({...form, agentPhone:e.target.value})} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Makelaar e‑mail</label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" placeholder="makelaar@bedrijf.fr" value={form.agentEmail} onChange={(e)=>setForm({...form, agentEmail:e.target.value})} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Geplande bezichtiging (datum/tijd)</label>
                <input type="datetime-local" className="mt-1 w-full rounded-xl border px-3 py-2" value={form.viewingAt} onChange={(e)=>setForm({...form, viewingAt:e.target.value})} />
                <p className="mt-1 text-xs text-slate-500">Tip: dit gebruikt je lokale tijdzone.</p>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Status<span className="text-rose-600">*</span></label>
              <select className={`mt-1 w-full rounded-xl border px-3 py-2 ${errors.status?"border-rose-400":''}`} value={form.status} onChange={(e)=>setForm({...form, status:e.target.value})}>
                <option value="">— Kies status —</option>
                {STATUS_OPTIONS.map((opt)=>(<option key={opt.value} value={opt.value}>{opt.label}</option>))}
              </select>
              {errors.status && <p className="text-xs text-rose-600">{errors.status}</p>}
            </div>

            <div>
              <label className="text-sm font-medium">Notities</label>
              <textarea className="mt-1 w-full rounded-xl border px-3 py-2" rows={2} placeholder="Parkeren bij achteringang, sleutel ophalen bij buur..." value={form.notes} onChange={(e)=>setForm({...form, notes:e.target.value})} />
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

        {/* Controls */}
        <section className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2">
            <input className="w-64 rounded-xl border px-3 py-2" placeholder="Zoek op adres, plaats, makelaar..." value={filter} onChange={(e)=>setFilter(e.target.value)} />
            <select className="rounded-xl border px-3 py-2" value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)}>
              <option value="">Alle statussen</option>
              {STATUS_OPTIONS.map((o)=>(<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
          </div>
          <div className="flex gap-2">
            <label className="text-sm">Sorteren:
              <select className="ml-2 rounded-xl border px-3 py-2" value={sortBy} onChange={(e)=>setSortBy(e.target.value)}>
                <option value="createdDesc">Nieuwste eerst</option>
                <option value="cityAsc">Plaats A→Z</option>
                <option value="statusAsc">Status A→Z</option>
              </select>
            </label>
          </div>
        </section>

        {/* List */}
        <section className="space-y-3">
          {visible.length === 0 && (
            <div className="rounded-2xl border bg-white p-6 text-center text-slate-600">Nog geen woningen opgeslagen.</div>
          )}
          {visible.map((it, idx) => (
            <article key={it.id} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="grow">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold">{it.title || "(Geen titel)"}</h3>
                      <span className={badgeClass(it.status)}>{STATUS_OPTIONS.find(s=>s.value===it.status)?.label || it.status}</span>
                      {averageRating(it.ratings) > 0 && (
                        <span className="ml-2 rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-amber-700">⭐ {averageRating(it.ratings)}/5</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-700">
                      {it.address && <span>{it.address}, </span>}
                      {[it.postalCode, it.city].filter(Boolean).join(" ")} 
                      {it.country ? `, ${it.country}` : ""}
                    </p>
                    {(it.agencyName) && (
                      <p className="text-xs text-slate-600">Makelaardij: {it.agencyName}</p>
                    )}
                    {(it.agentName || it.agentPhone || it.agentEmail) && (
                      <p className="text-xs text-slate-600">Makelaar: {[it.agentName, it.agentPhone, it.agentEmail].filter(Boolean).join(" · ")}</p>
                    )}

                    {/* Inline bewerken: status + viewingAt */}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label className="text-xs text-slate-600">Status</label>
                      <select
                        className="rounded-lg border px-2 py-1 text-xs"
                        value={it.status}
                        onChange={(e)=>updateItem(it.id,{ status: e.target.value })}
                      >
                        {STATUS_OPTIONS.map((o)=>(<option key={o.value} value={o.value}>{o.label}</option>))}
                      </select>

                      <label className="ml-2 text-xs text-slate-600">Bezichtiging</label>
                      <input
                        type="datetime-local"
                        className="rounded-lg border px-2 py-1 text-xs"
                        value={it.viewingAt || ""}
                        onChange={(e)=>updateItem(it.id,{ viewingAt: e.target.value })}
                      />
                      {it.viewingAt && (
                        <span className="text-xs text-slate-600">({formatViewing(it.viewingAt)})</span>
                      )}
                    </div>

                    {/* Beoordeling */}
                    <div className="mt-3 rounded-xl border bg-slate-50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <h4 className="text-sm font-semibold">Beoordeling</h4>
                        <span className="text-xs text-slate-600">Gemiddelde: {averageRating(it.ratings) || "–"}/5</span>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <StarRating value={it.ratings?.overall || 0} onChange={(v)=>updateRating(it.id,'overall',v)} label="Algehele indruk" />
                        <StarRating value={it.ratings?.location || 0} onChange={(v)=>updateRating(it.id,'location',v)} label="Locatie / Ligging" />
                        <StarRating value={it.ratings?.accessibility || 0} onChange={(v)=>updateRating(it.id,'accessibility',v)} label="Bereikbaarheid" />
                        <StarRating value={it.ratings?.business || 0} onChange={(v)=>updateRating(it.id,'business',v)} label="Bedrijfspotentieel" />
                        <StarRating value={it.ratings?.renovation || 0} onChange={(v)=>updateRating(it.id,'renovation',v)} label="Benodigd verbouwingsbudget" hint="5 = weinig budget nodig" />
                        <StarRating value={it.ratings?.parking || 0} onChange={(v)=>updateRating(it.id,'parking',v)} label="Parkeergelegenheid" />
                        <StarRating value={it.ratings?.pool || 0} onChange={(v)=>updateRating(it.id,'pool',v)} label="Zwembad" />
                        <StarRating value={it.ratings?.privateAreas || 0} onChange={(v)=>updateRating(it.id,'privateAreas',v)} label="Privévertrekken" />
                        <StarRating value={it.ratings?.feasibility || 0} onChange={(v)=>updateRating(it.id,'feasibility',v)} label="Realiseerbaarheid" />
                      </div>
                      {it.status !== 'bezichtigd' && (
                        <p className="mt-2 text-xs text-slate-500">Tip: markeer de status als <em>Bezichtigd</em> zodra je de beoordeling definitief maakt.</p>
                      )}
                    </div>

                    {it.notes && <p className="mt-2 text-sm text-slate-600">🗒️ {it.notes}</p>}
                  </div>

                  <div className="flex flex-wrap items-start gap-2">
                    <a href={buildGoogleMapsUrl(it)} target="_blank" rel="noopener noreferrer" className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50">Google Maps</a>
                    <a href={buildOsmUrl(it)} target="_blank" rel="noopener noreferrer" className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50">OpenStreetMap</a>
                    <button onClick={()=>startEdit(it)} className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50">Bewerken</button>
                    <button onClick={()=>remove(it.id)} className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-rose-50">Verwijderen</button>
                    <button onClick={()=>move(it.id,"up")} disabled={idx===0} className="rounded-xl border px-3 py-2 text-sm shadow-sm disabled:opacity-40">↑</button>
                    <button onClick={()=>move(it.id,"down")} disabled={idx===visible.length-1} className="rounded-xl border px-3 py-2 text-sm shadow-sm disabled:opacity-40">↓</button>
                  </div>
                </div>

                {it.url && (
                  <LinkPreview url={it.url} />
                )}
              </div>
            </article>
          ))}
        </section>

        <footer className="mt-10 space-y-1 text-center text-xs text-slate-500">
          <p>Realtime via Firestore. Zonder board werk je lokaal (alleen dit apparaat).</p>
          <p>Vergeet niet je Firebase config te vullen en je Vercel-domain toe te voegen bij Authorized domains. · Build: Firestore Sync v1</p>
        </footer>
      </div>
    </div>
  );
}
