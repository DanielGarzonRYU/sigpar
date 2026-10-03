/**
 * Cliente de la API SIGPAR.
 * - Envía el token JWT en cada petición.
 * - Si el servidor está "despertando" (Render gratis) o hay un corte de red,
 *   muestra "Conectando con el servidor…" y reintenta solo, sin perder la operación.
 */
// Ruta relativa a la página: funciona en la raíz del dominio (Render) y también dentro de una
// subcarpeta de XAMPP (http://localhost/SIGPARK_WEB/public/).
const BASE = 'api';
const TOKEN_KEY = 'sigpar_token';
const SESSION_KEY = 'sigpar_session';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
};

export const auth = {
  get token() { return store.get(TOKEN_KEY); },
  get session() { try { return JSON.parse(store.get(SESSION_KEY) || 'null'); } catch { return null; } },
  save(token, session) { store.set(TOKEN_KEY, token); store.set(SESSION_KEY, JSON.stringify(session)); },
  updateSession(session) { store.set(SESSION_KEY, JSON.stringify(session)); },
  clear() { store.del(TOKEN_KEY); store.del(SESSION_KEY); },
};

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

let banner = null;
let pendingRetries = 0;
function showBanner(text) {
  pendingRetries++;
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'conn-banner';
    document.body.appendChild(banner);
  }
  banner.innerHTML = `<span class="spinner" style="width:14px;height:14px"></span> ${text}`;
}
function hideBanner() {
  pendingRetries = Math.max(0, pendingRetries - 1);
  if (banner && pendingRetries === 0) { banner.remove(); banner = null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRY_STATUS = [502, 503, 504];
const MAX_ATTEMPTS = 8; // ~90 s en total: cubre el arranque en frío de Render

export async function request(method, path, body, { retry = true, timeout = 60000 } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;

  let bannerShown = false;
  try {
    for (let attempt = 1; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      let res;
      try {
        res = await fetch(BASE + path, {
          method, headers, signal: ctrl.signal,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        res = null; // error de red o timeout
      } finally {
        clearTimeout(timer);
      }

      // Reintentar es seguro en consultas (GET) y cuando el servidor respondió 502/503/504
      // (no alcanzó a procesar nada). En un POST sin respuesta NO se reintenta: la operación
      // pudo haberse guardado y repetirla podría, por ejemplo, cobrar dos veces una renovación.
      const idempotente = method === 'GET';
      const transient = (!res && idempotente) || (res && RETRY_STATUS.includes(res.status));
      if (transient && retry && attempt < MAX_ATTEMPTS) {
        if (!bannerShown) { showBanner('Conectando con el servidor… (puede tardar unos segundos)'); bannerShown = true; }
        await sleep(Math.min(2000 * attempt, 12000));
        continue;
      }
      if (!res) {
        throw new ApiError(idempotente
          ? 'No fue posible conectar con el servidor. Revise su conexión a Internet.'
          : 'Se perdió la conexión y no se sabe si la operación se guardó. Revise el historial antes de repetirla.', 0);
      }

      let data = null;
      try { data = await res.json(); } catch { data = null; }

      if (res.status === 401 && path !== '/auth/login') {
        auth.clear();
        location.href = 'index.html?expirada=1';
        throw new ApiError('Sesión expirada', 401, data);
      }
      if (!res.ok || (data && data.ok === false)) {
        throw new ApiError(data?.error || `Error ${res.status}`, res.status, data);
      }
      return data;
    }
  } finally {
    if (bannerShown) hideBanner();
  }
}

export const api = {
  get: (p, params) => {
    const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')) : '';
    return request('GET', p + qs);
  },
  post: (p, b = {}) => request('POST', p, b),
  put: (p, b = {}) => request('PUT', p, b),
  patch: (p, b = {}) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
};
