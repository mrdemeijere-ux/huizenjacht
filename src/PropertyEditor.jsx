import React, { useState } from "react";

export PropertyEditor({ item, onClose, onUpdate }) {
  const [form, setForm] = useState({ ...item });
  const save = (patch) => { onUpdate?.(patch); };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full sm:w-[520px] bg-white shadow-xl rounded-t-2xl sm:rounded-none">
        <header className="sticky top-0 z-10 border-b bg-white p-3 flex items-center justify-between">
          <h3 className="text-base font-semibold truncate">{form.title || "(Geen titel)"}</h3>
          <button className="rounded-lg border px-3 py-1.5 text-sm" onClick={onClose}>Sluiten</button>
        </header>
        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs text-slate-600">Titel*</label>
            <input className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm"
              value={form.title || ""}
              onChange={(e)=>{ const v=e.target.value; setForm(f=>({...f,title:v})); save({title:v}); }}
            />
          </div>
          <div>
            <label className="text-xs text-slate-600">Link*</label>
            <input className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm"
              value={form.url || ""}
              onChange={(e)=>{ const v=e.target.value; setForm(f=>({...f,url:v})); save({url:v}); }}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-600">Status</label>
              <select className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm"
                value={form.status || ""}
                onChange={(e)=>{ const v=e.target.value; setForm(f=>({...f,status:v})); save({status:v}); }}
              >
                <option value="">—</option>
                {typeof STATUS_OPTIONS !== 'undefined' && STATUS_OPTIONS.map(o=>(<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-600">Prijs</label>
              <input inputMode="decimal" className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm"
                value={form.price ?? ""}
                onChange={(e)=>{ const v=e.target.value.replace(',', '.'); setForm(f=>({...f,price:v})); save({price:Number(v)||0}); }}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-600">Bezichtiging</label>
            <input type="datetime-local" className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm"
              value={form.viewingAt || ""}
              onChange={(e)=>{ const v=e.target.value; setForm(f=>({...f,viewingAt:v})); save({viewingAt:v}); }}
            />
          </div>
          <div>
            <label className="text-xs text-slate-600">Notities</label>
            <textarea rows={4} className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm"
              value={form.notes || ""}
              onChange={(e)=>{ const v=e.target.value; setForm(f=>({...f,notes:v})); save({notes:v}); }}
            />
          </div>
        </div>
      </aside>
    </div>
  );
}
