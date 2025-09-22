import React, { useEffect, useMemo, useState } from "react";

// Huizenjacht – single-file MVP (React + Tailwind + Firestore realtime sync)
// - Firebase Auth (anonymous) + Firestore realtime sync per "Board"
// - Create/Join board, copy invite link, live multi-device updates
// - Offline cache via Firestore persistentLocalCache
// - Backward compatible: zonder board werkt alles lokaal (localStorage)

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
  writeBatch,
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
const STORAGE_KEY = "huizenjacht_v1";
const BOARD_KEY = "huizenjacht_board_id";

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

// Rich link preview (server-side metadata fetch via Vercel function)
function SmartLinkPreview({ url }) {
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const endpoint = import.meta?.env?.VITE_LINK_PREVIEW_ENDPOINT;

  useEffect(() => {
    let alive = true;
    if (!endpoint || !url) return;
    setLoading(true);
    fetch(`${endpoint}?url=${encodeURIComponent(url)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive) return;
        setMeta(data && (data.title || data.image || data.description) ? data : null);
      })
      .catch(() => {
        if (!alive) return;
        setMeta(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [endpoint, url]);

  if (!endpoint) return null; // compacte preview is verwijderd

  if (meta) {
    const parts = getUrlParts(url);
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

  return null; // geen compacte fallback
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
            <>⚠️ Je werkt lokaal — <span className="font-medium">geen sync</span>. Maak of join een board om te delen.</>
          )}
        </div>
      </div>
    </div>
  );
}

// ===================== App =====================
export default function App() {
  const [items, setItems] = useLocalStorageState([]); // fallback voor lokaal
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState("createdDesc");
  const [errors, setErrors] = useState({});

  const [user, setUser] = useState(null);
  const [boardId, setBoardId] = useState(() => {
    const urlBoard = new URLSearchParams(window.location.search).get("board");
    return (
      urlBoard || (typeof localStorage !== "undefined" ? localStorage.getItem(BOARD_KEY) : "") || ""
    );
  });
  const [liveStatus, setLiveStatus] = useState("offline");
  const [syncError, setSyncError] = useState(null);
  const [busyCreate, setBusyCreate] = useState(false);
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
    if (!boardId || !user) return;
    if (typeof localStorage !== "undefined") localStorage.setItem(BOARD_KEY, boardId);

    // Zorg dat board-doc bestaat
    setDoc(doc(db, "boards", boardId), { createdAt: serverTimestamp() }, { merge: true }).catch(() => {});

    const qRef = query(
      collection(db, "boards", boardId, "items"),
      orderBy("order", "desc")
    );

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const list = snap.docs.map((d) => ({ ...d.data(), id: d.id })); // Firestore ID wint
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
  }, [boardId, user]);

  // Legacy items id fix (alleen lokaal)
  useEffect(() => {
    if (boardId) return;
    const fixed = items.map((it) => (it.id ? it : { ...it, id: uuid() }));
    if (JSON.stringify(fixed) !== JSON.stringify(items)) setItems(fixed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    const { id: _drop, ...formNoId } = form; // id niet meesturen
    const withMeta = { ...formNoId, createdAt: Date.now(), order: Date.now() };

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
      const { id: _idDrop, ...payload } = form; // id niet in payload
      await updateDoc(doc(db, "boards", boardId, "items", editingId), payload);
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
    a.download = `huizenjacht_${new Date().toISOString().slice(0, 10)}.json`;
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
          const { id: _old, ...payload } = d;
          const ref = doc(colRef);
          batch.set(ref, {
            ...payload,
            createdAt: serverTimestamp(),
            order: d.order || Date.now(),
          });
        });
        await batch.commit();
      } catch (err) {
        alert("Import mislukt: " + (err?.message || String(err)));
      }
    };
    reader.readAsText(file);
  }

  function copyBoardLink() {
    if (!boardId) {
      alert("Geen board actief. Maak of join eerst een board.");
      return;
    }
    const url = `${window.location.origin}${window.location.pathname}?board=${encodeURIComponent(
      boardId
    )}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => alert("Board-link gekopieerd"));
    } else {
      prompt("Kopieer deze link:", url);
    }
  }

  async function createBoard() {
    if (!configOk) {
      alert("Firebase config ontbreekt of is nog niet ingevuld.");
      return;
    }
    setBusyCreate(true);
    const newId = uuid().replace(/[^a-zA-Z0-9_-]/g, "");
    try {
      if (!auth.currentUser) await signInAnonymously(auth);
      await setDoc(doc(db, "boards", newId), {
        owner: auth.currentUser?.uid || null,
        createdAt: serverTimestamp(),
      });
      setBoardId(newId);
      if (typeof localStorage !== "undefined") localStorage.setItem(BOARD_KEY, newId);
      if (items && items.length) {
        const batch = writeBatch(db);
        const colRef = collection(db, "boards", newId, "items");
        items.forEach((d) => {
          const { id: _old, ...payload } = d;
          const ref = doc(colRef);
          batch.set(ref, {
            ...payload,
            createdAt: serverTimestamp(),
            order: d.order || Date.now(),
          });
        });
        await batch.commit();
      }
      alert("Board aangemaakt en (eventueel) lokale items gemigreerd.");
    } catch (e) {
      console.error("createBoard failed", e);
      alert("Board maken faalde: " + (e?.message || String(e)));
    } finally {
      setBusyCreate(false);
    }
  }

  function joinBoardPrompt() {
    const id = prompt("Voer Board ID in (van gedeelde link)", "");
    if (!id) return;
    setBoardId(id.trim());
    if (typeof localStorage !== "undefined") localStorage.setItem(BOARD_KEY, id.trim());
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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900">
      <TopStatusBar boardId={boardId} liveStatus={liveStatus} />
      <div className="mx-auto max-w-6xl p-6">
        <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Huizenjacht – MVP</h1>
            <p className="text-sm text-slate-600">
              Beheer bezichtigingen, makelaars en routes. Realtime sync per board.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span>Sync status: {liveStatus}</span>
              {boardId && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5">Board: {boardId}</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-sm">
              <span>Importeer JSON</span>
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])}
              />
            </label>
            <button
              onClick={exportJson}
              className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50"
            >
              Exporteer JSON
            </button>
            <button
              onClick={copyBoardLink}
              className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50"
            >
              Kopieer board-link
            </button>
          </div>
        </header>

        {/* Board controls */}
        <section className="mb-4 flex flex-wrap items-center gap-2">
          {!boardId && (
            <>
              <button
                onClick={createBoard}
                disabled={busyCreate || !configOk}
                className="rounded-2xl bg-slate-900 px-4 py-2 text-white shadow hover:opacity-90 disabled:opacity-50"
              >
                {busyCreate ? "Aanmaken…" : "Nieuw board"}
              </button>
              <button
                onClick={joinBoardPrompt}
                className="rounded-2xl border px-4 py-2 shadow-sm"
              >
                Board joinen
              </button>
              {!configOk && (
                <span className="text-sm text-rose-700">
                  ⚠️ Firebase config ontbreekt. Vul je config of env vars.
                </span>
              )}
              <span className="text-sm text-slate-600">
                (zonder board werk je lokaal op dit apparaat)
              </span>
            </>
          )}
          {boardId && (
            <>
              <button
                onClick={() => {
                  if (typeof localStorage !== "undefined") localStorage.removeItem(BOARD_KEY);
                  setBoardId("");
                }}
                className="rounded-2xl border px-4 py-2 shadow-sm"
              >
                Board verlaten
              </button>
              <button onClick={copyBoardLink} className="rounded-2xl border px-4 py-2 shadow-sm">
                Deel invite-link
              </button>
            </>
          )}
        </section>

        {syncError && (
          <div className="mb-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
            <div className="font-semibold">Sync fout</div>
            <div className="mt-1">
              <code className="rounded bg-white/60 px-1">{syncError.code || "unknown"}</code> ·{" "}
              {syncError.message || String(syncError)}
            </div>
          </div>
        )}

        {!boardId && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="font-medium">Je werkt nu lokaal (alleen dit apparaat).</div>
            <div>
              Gebruik <span className="font-semibold">Nieuw board</span> of{" "}
              <span className="font-semibold">Board joinen</span> om te synchroniseren met andere
              apparaten.
            </div>
          </div>
        )}

        {/* Formulier */}
        <section className="mb-8 rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">
            {isEditing ? "Woning bewerken" : "Nieuwe woning toevoegen"}
          </h2>
          <form
            onSubmit={isEditing ? (e) => { e.preventDefault(); saveEdit(); } : handleSubmit}
            className="grid grid-cols-1 gap-4 md:grid-cols-2"
          >
            <div>
              <label className="text-sm font-medium">
                Titel / Naam woning<span className="text-rose-600">*</span>
              </label>
              <input
                className={`${"mt-1 w-full rounded-xl border px-3 py-2"} ${
                  errors.title ? "border-rose-400" : ""
                }`}
                placeholder="Bijv. Charmehuisje bij Dijon"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
              {errors.title && <p className="text-xs text-rose-600">{errors.title}</p>}
            </div>
            <div>
              <label className="text-sm font-medium">
                Link naar woning<span className="text-rose-600">*</span>
              </label>
              <input
                className={`${"mt-1 w-full rounded-xl border px-3 py-2"} ${
                  errors.url ? "border-rose-400" : ""
                }`}
                placeholder="https://..."
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
              {errors.url && <p className="text-xs text-rose-600">{errors.url}</p>}
            </div>

            <div className="md:col-span-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-sm font-medium">
                  Adres<span className="text-rose-600">*</span>
                </label>
                <input
                  className={`${"mt-1 w-full rounded-xl border px-3 py-2"} ${
                    errors.address ? "border-rose-400" : ""
                  }`}
                  placeholder="Rue de ... 12"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
                {errors.address && <p className="text-xs text-rose-600">{errors.address}</p>}
              </div>
              <div>
                <label className="text-sm font-medium">Postcode<span className="text-rose-600 opacity-0">*</span></label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  placeholder="75001"
                  value={form.postalCode}
                  onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">
                  Plaats<span className="text-rose-600">*</span>
                </label>
                <input
                  className={`${"mt-1 w-full rounded-xl border px-3 py-2"} ${
                    errors.city ? "border-rose-400" : ""
                  }`}
                  placeholder="Paris"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
                {errors.city && <p className="text-xs text-rose-600">{errors.city}</p>}
              </div>
              <div>
                <label className="text-sm font-medium">Land</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Prijs (EUR)</label>
              <input
                type="number"
                inputMode="decimal"
                className="mt-1 w-full rounded-xl border px-3 py-2"
                placeholder="350000"
                value={form.price ?? ""}
                onChange={(e) =>
                  setForm({ ...form, price: e.target.value === "" ? "" : Number(e.target.value) })
                }
              />
              <p className="text-xs text-slate-500 mt-1">
                Vul een bedrag in zonder punten of €-teken, bijv. 350000.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium">GPS Latitude (opt.)</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  placeholder="48.8566"
                  value={form.lat}
                  onChange={(e) => setForm({ ...form, lat: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">GPS Longitude (opt.)</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  placeholder="2.3522"
                  value={form.lng}
                  onChange={(e) => setForm({ ...form, lng: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 md:col-span-2">
              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Makelaardij</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  placeholder="Agence BelleMaison"
                  value={form.agencyName}
                  onChange={(e) => setForm({ ...form, agencyName: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Makelaar naam</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  placeholder="Mme Dupont"
                  value={form.agentName}
                  onChange={(e) => setForm({ ...form, agentName: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Makelaar telefoon</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  placeholder="+33 ..."
                  value={form.agentPhone}
                  onChange={(e) => setForm({ ...form, agentPhone: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Makelaar e‑mail</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  placeholder="makelaar@bedrijf.fr"
                  value={form.agentEmail}
                  onChange={(e) => setForm({ ...form, agentEmail: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Geplande bezichtiging (datum/tijd)</label>
                <input
                  type="datetime-local"
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={form.viewingAt}
                  onChange={(e) => setForm({ ...form, viewingAt: e.target.value })}
                />
                <p className="mt-1 text-xs text-slate-500">Tip: dit gebruikt je lokale tijdzone.</p>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">
                Status<span className="text-rose-600">*</span>
              </label>
              <select
                className={`${"mt-1 w-full rounded-xl border px-3 py-2"} ${
                  errors.status ? "border-rose-400" : ""
                }`}
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="">— Kies status —</option>
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {errors.status && <p className="text-xs text-rose-600">{errors.status}</p>}
            </div>

            <div>
              <label className="text-sm font-medium">Notities</label>
              <textarea
                className="mt-1 w-full rounded-xl border px-3 py-2"
                rows={2}
                placeholder="Parkeren bij achteringang, sleutel ophalen bij buur..."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            <div className="md:col-span-2 flex items-center gap-2 pt-2">
              {!isEditing && (
                <button
                  className="rounded-2xl bg-slate-900 px-4 py-2 text-white shadow hover:opacity-90"
                  type="submit"
                >
                  Toevoegen
                </button>
              )}
              {isEditing && (
                <>
                  <button
                    className="rounded-2xl bg-slate-900 px-4 py-2 text-white shadow hover:opacity-90"
                    type="button"
                    onClick={saveEdit}
                  >
                    Opslaan
                  </button>
                  <button
                    className="rounded-2xl border px-4 py-2 shadow-sm"
                    type="button"
                    onClick={cancelEdit}
                  >
                    Annuleren
                  </button>
                </>
              )}
              <button
                type="button"
                className="ml-auto rounded-2xl border px-3 py-2 text-sm shadow-sm"
                onClick={resetForm}
              >
                Formulier leegmaken
              </button>
            </div>
          </form>
        </section>

        {/* Filters/Sortering */}
        <section className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2">
            <input
              className="w-64 rounded-xl border px-3 py-2"
              placeholder="Zoek op adres, plaats, makelaar..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <select
              className="rounded-xl border px-3 py-2"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Alle statussen</option>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <label className="text-sm">
              Sorteren:
              <select
                className="ml-2 rounded-xl border px-3 py-2"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
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
        <section className="space-y-3">
          {visible.length === 0 && (
            <div className="rounded-2xl border bg-white p-6 text-center text-slate-600">
              Nog geen woningen opgeslagen.
            </div>
          )}
          {visible.map((it, idx) => (
            <article key={it.id} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="grow">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold">{it.title || "(Geen titel)"}</h3>
                      <span className={badgeClass(it.status)}>
                        {STATUS_OPTIONS.find((s) => s.value === it.status)?.label || it.status}
                      </span>
                      {Number(it.price) > 0 && (
                        <span className="ml-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          {formatEUR(it.price)}
                        </span>
                      )}
                      {averageRating(it.ratings) > 0 && (
                        <span className="ml-2 rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          ⭐ {averageRating(it.ratings)}/5
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-700">
                      {it.address && <span>{it.address}, </span>}
                      {[it.postalCode, it.city].filter(Boolean).join(" ")}
                      {it.country ? `, ${it.country}` : ""}
                    </p>
                    {it.agencyName && (
                      <p className="text-xs text-slate-600">Makelaardij: {it.agencyName}</p>
                    )}
                    {(it.agentName || it.agentPhone || it.agentEmail) && (
                      <p className="text-xs text-slate-600">
                        Makelaar: {[it.agentName, it.agentPhone, it.agentEmail].filter(Boolean).join(" · ")}
                      </p>
                    )}

                    {/* Inline wijzigen: status + datum/tijd */}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label className="text-xs text-slate-600">Status</label>
                      <select
                        className="rounded-lg border px-2 py-1 text-xs"
                        value={it.status}
                        onChange={(e) => updateItem(it.id, { status: e.target.value })}
                      >
                        {STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>

                      <label className="ml-2 text-xs text-slate-600">Bezichtiging</label>
                      <input
                        type="datetime-local"
                        className="rounded-lg border px-2 py-1 text-xs"
                        value={it.viewingAt || ""}
                        onChange={(e) => updateItem(it.id, { viewingAt: e.target.value })}
                      />
                      {it.viewingAt && (
                        <span className="text-xs text-slate-600">({formatViewing(it.viewingAt)})</span>
                      )}
                    </div>

                    {/* Beoordelingen */}
                    <div className="mt-3 rounded-xl border bg-slate-50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <h4 className="text-sm font-semibold">Beoordeling</h4>
                        <span className="text-xs text-slate-600">
                          Gemiddelde: {averageRating(it.ratings) || "–"}/5
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <StarRating
                          value={it.ratings?.overall || 0}
                          onChange={(v) => updateRating(it.id, "overall", v)}
                          label="Algehele indruk"
                        />
                        <StarRating
                          value={it.ratings?.location || 0}
                          onChange={(v) => updateRating(it.id, "location", v)}
                          label="Locatie / Ligging"
                        />
                        <StarRating
                          value={it.ratings?.accessibility || 0}
                          onChange={(v) => updateRating(it.id, "accessibility", v)}
                          label="Bereikbaarheid"
                        />
                        <StarRating
                          value={it.ratings?.business || 0}
                          onChange={(v) => updateRating(it.id, "business", v)}
                          label="Bedrijfspotentieel"
                        />
                        <StarRating
                          value={it.ratings?.renovation || 0}
                          onChange={(v) => updateRating(it.id, "renovation", v)}
                          label="Benodigd verbouwingsbudget"
                          hint="5 = weinig budget nodig"
                        />
                        <StarRating
                          value={it.ratings?.parking || 0}
                          onChange={(v) => updateRating(it.id, "parking", v)}
                          label="Parkeergelegenheid"
                        />
                        <StarRating
                          value={it.ratings?.pool || 0}
                          onChange={(v) => updateRating(it.id, "pool", v)}
                          label="Zwembad"
                        />
                        <StarRating
                          value={it.ratings?.privateAreas || 0}
                          onChange={(v) => updateRating(it.id, "privateAreas", v)}
                          label="Privévertrekken"
                        />
                        <StarRating
                          value={it.ratings?.feasibility || 0}
                          onChange={(v) => updateRating(it.id, "feasibility", v)}
                          label="Realiseerbaarheid"
                        />
                      </div>
                      {it.status !== "bezichtigd" && (
                        <p className="mt-2 text-xs text-slate-500">
                          Tip: markeer de status als <em>Bezichtigd</em> zodra je de beoordeling definitief
                          maakt.
                        </p>
                      )}
                    </div>

                    {it.notes && <p className="mt-2 text-sm text-slate-600">🗒️ {it.notes}</p>}
                  </div>

                  <div className="flex flex-wrap items-start gap-2">
                    <a
                      href={buildGoogleMapsUrl(it)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50"
                    >
                      Google Maps
                    </a>
                    <a
                      href={buildOsmUrl(it)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50"
                    >
                      OpenStreetMap
                    </a>
                    <button
                      onClick={() => startEdit(it)}
                      className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-slate-50"
                    >
                      Bewerken
                    </button>
                    <button
                      onClick={() => remove(it.id)}
                      className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-rose-50"
                    >
                      Verwijderen
                    </button>
                    <button
                      onClick={() => move(it.id, "up")}
                      disabled={idx === 0}
                      className="rounded-xl border px-3 py-2 text-sm shadow-sm disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move(it.id, "down")}
                      disabled={idx === visible.length - 1}
                      className="rounded-xl border px-3 py-2 text-sm shadow-sm disabled:opacity-40"
                    >
                      ↓
                    </button>
                  </div>
                </div>

                {/* Rijke link preview (compacte valt weg) */}
                {it.url && <SmartLinkPreview url={it.url} />}
              </div>
            </article>
          ))}
        </section>

        <footer className="mt-10 space-y-1 text-center text-xs text-slate-500">
          <p>Realtime via Firestore. Zonder board werk je lokaal (alleen dit apparaat).</p>
          <p>
            Vergeet niet je Firebase config te vullen en je Vercel-domein toe te voegen bij Authorized
            domains. · Build: Firestore Sync v1 (met prijs & rich link preview)
          </p>
        </footer>
      </div>
    </div>
  );
}

// Maps helpers
function buildGoogleMapsUrl(item) {
  const hasCoords = item.lat && item.lng;
  if (hasCoords) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${item.lat},${item.lng}`)}`;
  }
  const q = [item.address, item.postalCode, item.city, item.country]
    .filter(Boolean)
    .join(", ");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}

function buildOsmUrl(item) {
  if (item.lat && item.lng) {
    const coords = `;${item.lat},${item.lng}`;
    return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(coords)}`;
  }
  const q = [item.address, item.postalCode, item.city, item.country]
    .filter(Boolean)
    .join(", ");
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}`;
}
