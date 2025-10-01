// src/urlToRoughPlace.js
export function urlToRoughPlace(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.toLowerCase();

    // Helpers
    const compact = (s) => s.replace(/\s+/g, " ").trim();
    const cap = (s) => s.replace(/\b\w/g, c => c.toUpperCase());
    const parts = (s) => s.split(/[\/\-_,]+/).filter(Boolean);

    // 1) Domein-specifieke extractors (makkelijk uit te breiden)
    if (host.endsWith("lefigaro.fr")) {
      // Voorbeeld: /annonces/propriete-dordogne-aquitaine-france/86831135/
      // Pak alles tussen 'propriete-' en '-france'
      const m = path.match(/propriete-([a-z0-9\-]+)-france/);
      if (m) {
        const tokens = m[1].split("-").filter(Boolean);
        // Vaak: <departement> - <regio> ; zet er “France” achter als land
        const guess = cap(compact(tokens.join(" "))) + ", France";
        return guess;
      }
    }

    if (host.includes("seloger.com")) {
      // Vaak: .../immobilier/achat/ville-XXXX/...
      const m = path.match(/ville-([a-z0-9\-]+)/);
      if (m) return `France ${m[1]}`;
    }

    if (host.includes("immobilienscout24") || host.includes("immonet.de")) {
      // Duitse sites bevatten soms -in-<stadt>-
      const m = path.match(/-in-([a-z0-9\-]+)-/);
      if (m) return cap(m[1].replace(/-/g, " "));
    }

    if (host.includes("idealista.") || host.includes("fotocasa.")) {
      // ES: vaak .../<provincia>/<municipio>/...
      const segs = parts(path);
      if (segs.length > 1) return cap(segs.slice(-2).join(", "));
    }

    // 2) Generieke fallback: neem betekenisvolle tokens uit het pad
    const segs = parts(path);
    // Filter weg: “annonces”, “propriete”, “france”, “achat”, getallen, etc.
    const bad = new Set([
      "annonces","annonce","propriete","proprietes","maison","appartement",
      "house","apartment","france","achat","vente","a-vendre","a-vendre-",
      "immobilier","property","listing","ref","id"
    ]);
    const cand = segs.filter(t => !bad.has(t) && !/^\d+$/.test(t)).slice(0, 4);
    if (cand.length >= 1) {
      return cap(compact(cand.join(" ")));
    }

    // 3) Fallback op hostname
    return cap(host.split(".")[0]);
  } catch {
    return null;
  }
}
