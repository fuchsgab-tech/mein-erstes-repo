// Verbindung zum Server
const KEY = 'zg.token';

// Die Demo-Version (demo/api.js) setzt das auf true
export const isDemo = false;

let token = null;
try {
  token = localStorage.getItem(KEY);
} catch {
  /* privater Modus */
}

export const auth = {
  get token() {
    return token;
  },
  set(t) {
    token = t || null;
    try {
      if (token) localStorage.setItem(KEY, token);
      else localStorage.removeItem(KEY);
    } catch {
      /* egal */
    }
  },
};

// Live-Verbindung zum Server: meldet neue Termine, Kommentare, wer online ist …
// Wiederverbinden nach Abbrüchen übernimmt app.js (connectLive): Bei einem Fehler wird die
// Verbindung hier geschlossen und onError gerufen – so gibt es nie zwei Verbindungen gleichzeitig.
export function openStream(onMessage, { onOpen, onError } = {}) {
  const source = new EventSource(`/api/stream?token=${encodeURIComponent(token || '')}`);
  let done = false;
  source.onopen = () => !done && onOpen?.();
  source.onerror = () => {
    if (done) return;
    done = true;
    source.close();
    onError?.();
  };
  source.onmessage = (e) => {
    if (done) return;
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return; // kaputte Nachricht ignorieren
    }
    onMessage(msg);
  };
  return {
    close: () => {
      done = true;
      source.close();
    },
  };
}

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw Object.assign(new Error('Keine Verbindung zum Server.'), { status: 0 });
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* leer */
  }
  if (!res.ok) {
    // Profil auf dem Server unbekannt (z. B. Daten weg oder abgemeldet) – app.js zeigt dann eine Erklärung
    if (res.status === 401 && token) window.dispatchEvent(new CustomEvent('zg:unauthorized'));
    throw Object.assign(new Error(data?.error || 'Da ist etwas schiefgelaufen.'), { status: res.status });
  }
  return data;
}
