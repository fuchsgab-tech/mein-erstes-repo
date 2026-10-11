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
export function openStream(onMessage, { onOpen, onError } = {}) {
  const source = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
  source.onopen = () => onOpen?.();
  source.onerror = () => onError?.();
  source.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return; // kaputte Nachricht ignorieren
    }
    onMessage(msg);
  };
  return { close: () => source.close() };
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
    throw Object.assign(new Error(data?.error || 'Da ist etwas schiefgelaufen.'), { status: res.status });
  }
  return data;
}
