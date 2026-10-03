/**
 * Panel SIGPAR: navegación por rol, selector de sede, alertas y actualización en tiempo real.
 */
import { api, auth, request } from './api.js';
import { icon, esc, ROLES, modal, fail, ok, formData, placa, fecha, loading, avatar, fotoCuadrada } from './ui.js';
import { linkWhatsApp } from './extras.js';
import { iniciarTour, menuAyuda, yaVisto } from './tour.js';

if (!auth.token || !auth.session) {
  location.replace('index.html');
  await new Promise(() => {}); // detiene el módulo mientras el navegador redirige
}

const ALL = ['superadmin', 'admin', 'operador'];
const ADM = ['superadmin', 'admin'];

const ROUTES = [
  { section: 'Operación' },
  { id: 'dashboard',   label: 'Dashboard',          icon: 'dashboard', roles: ALL },
  { id: 'operacion',   label: 'Entradas y salidas', icon: 'operacion', roles: ALL },
  { id: 'movimientos', label: 'Historial',          icon: 'historial', roles: ALL },
  { id: 'abonados',    label: 'Abonados',           icon: 'abonados',  roles: ALL },
  { id: 'reportes',    label: 'Reportes',           icon: 'reportes',  roles: ALL },
  { section: 'Administración', roles: ADM },
  { id: 'espacios',    label: 'Espacios',           icon: 'espacios',  roles: ADM },
  { id: 'plano',       label: 'Plano',              icon: 'plano',     roles: ADM },
  { id: 'tarifas',     label: 'Tarifas',            icon: 'tarifas',   roles: ADM },
  { id: 'sedes',       label: 'Sedes',              icon: 'sedes',     roles: ['superadmin'] },
  { id: 'usuarios',    label: 'Usuarios',           icon: 'usuarios',  roles: ADM },
  { id: 'auditoria',   label: 'Auditoría',          icon: 'auditoria', roles: ADM },
  { id: 'configuracion', label: 'Configuración',    icon: 'config',    roles: ['superadmin'] },
  { section: 'Ayuda' },
  { id: 'ayuda',       label: 'Cómo usar',          icon: 'ayuda',     roles: ALL },
];

/** Nombre visible de una sección (el operador solo tiene el cierre de caja dentro de Reportes). */
const etiqueta = (r, rol) => (r.id === 'reportes' && rol === 'operador' ? 'Cierre de caja' : r.label);

// ------------------------------------------------------------ Estado global
const state = {
  user: auth.session.usuario,
  sedes: auth.session.sedes || [],
  empresa: auth.session.empresa,
  sede: 'all',
  timers: [],
  cleanup: null,
  nav: 0,
  alSalir: null,   // la vista actual puede pedir confirmación antes de salir (cambios sin guardar)
  oyentes: [],     // funciones de la vista actual que se ejecutan cuando algo cambió en el servidor
  hash: '',
  volviendo: false,
};

try { state.sede = localStorage.getItem('sigpar_sede') || 'all'; } catch { /* sin almacenamiento */ }
if (state.sede !== 'all' && !state.sedes.some((s) => String(s.id) === state.sede)) state.sede = 'all';
if (state.sedes.length === 1) state.sede = String(state.sedes[0].id);

/** Contexto que recibe cada vista. */
const ctx = {
  get user() { return state.user; },
  get sedes() { return state.sedes; },
  get sede() { return state.sede; },
  /** Sede concreta para operar (null si está en "Todas" con varias sedes). */
  get sedeId() { return state.sede === 'all' ? (state.sedes.length === 1 ? state.sedes[0].id : null) : Number(state.sede); },
  get sedeParam() { return state.sede === 'all' ? undefined : state.sede; },
  get sedeNombre() { return state.sede === 'all' ? 'Todas las sedes' : (state.sedes.find((s) => String(s.id) === String(state.sede))?.nombre || ''); },
  can: (...roles) => roles.includes(state.user.rol),
  /** Ejecuta fn cada ms mientras la vista esté abierta y la pestaña visible. */
  every(fn, ms) {
    // Nunca se lanza una actualización si la anterior no ha terminado (red lenta o servidor
    // despertando): así las peticiones no se acumulan justo cuando el servidor está más cargado.
    let enCurso = false;
    const id = setInterval(async () => {
      if (document.hidden || enCurso) return;
      enCurso = true;
      try { await fn(); } catch { /* cada vista maneja sus errores */ } finally { enCurso = false; }
    }, ms);
    state.timers.push(id);
  },
  go: (route) => { location.hash = '#/' + route; },
  refreshAlerts: () => loadAlerts(),
  setSede(id) { setSede(String(id)); },
  live(okState) { document.getElementById('live').classList.toggle('off', !okState); },
  alSalir(fn) { state.alSalir = fn; },
  /** fn se ejecuta cuando alguien (esta web, otro operador o la app) registra un cambio en la sede. */
  alCambiar(fn) { state.oyentes.push(fn); },
};

// ------------------------------------------------------------ Cambios en vivo
// Cada pocos segundos se pregunta al servidor si algo cambió en la sede (una consulta liviana).
// Si cambió, la pantalla abierta se actualiza sola: una salida registrada desde la app o por otro
// operador aparece en el historial, la caja, los espacios y el dashboard sin recargar la página.
let versionCambios = null;
let sedeCambios = null;
let vigilando = false;
async function vigilarCambios() {
  if (document.hidden || vigilando) return;
  vigilando = true;
  try {
    const qs = state.sede === 'all' ? '' : `?sede_id=${encodeURIComponent(state.sede)}`;
    const r = await request('GET', '/cambios' + qs, undefined, { retry: false, timeout: 15000 });
    const cambio = versionCambios !== null && sedeCambios === state.sede && r.version !== versionCambios;
    // Con una ventana abierta (un formulario, un recibo) no se toca la pantalla: se aplica al cerrarla
    if (cambio && document.querySelector('.modal-bg')) return;
    versionCambios = r.version;
    sedeCambios = state.sede;
    ctx.live(true);
    if (cambio) {
      loadAlerts();
      for (const fn of [...state.oyentes]) { try { await fn(); } catch { /* cada vista maneja sus errores */ } }
    }
  } catch { ctx.live(false); } finally { vigilando = false; }
}

// ------------------------------------------------------------ Layout
function renderShell() {
  const u = state.user;
  document.getElementById('empresa').textContent = state.empresa || 'Gestión de Parqueaderos';
  pintarUsuario();
  document.getElementById('menuBtn').innerHTML = icon.menu;
  document.getElementById('bellBtn').innerHTML = icon.bell;
  document.getElementById('ayudaBtn').innerHTML = icon.ayuda;
  updateThemeIcon();

  let html = '';
  for (const r of ROUTES) {
    if (r.roles && !r.roles.includes(u.rol)) continue;
    if (r.section) { html += `<div class="nav-section">${r.section}</div>`; continue; }
    html += `<a href="#/${r.id}" data-route="${r.id}">${icon[r.icon]}<span>${etiqueta(r, u.rol)}</span>${r.id === 'abonados' ? '<span class="badge orange hidden" id="navAlert"></span>' : ''}</a>`;
  }
  document.getElementById('nav').innerHTML = html;

  const sel = document.getElementById('sedeSel');
  const multi = state.sedes.length > 1;
  sel.innerHTML = (multi ? '<option value="all">Todas las sedes</option>' : '') +
    state.sedes.map((s) => `<option value="${s.id}">${esc(s.nombre)}</option>`).join('');
  sel.value = state.sede;
  sel.disabled = !multi;
  if (!state.sedes.length) document.getElementById('sedeBox').innerHTML = '<span class="badge red">Sin sede asignada</span>';
  sel.onchange = () => setSede(sel.value);

  const sidebar = document.getElementById('sidebar');
  document.getElementById('menuBtn').onclick = () => sidebar.classList.toggle('open');
  document.getElementById('nav').addEventListener('click', () => sidebar.classList.remove('open'));
  document.getElementById('sidebarBg').onclick = () => sidebar.classList.remove('open');
  document.getElementById('bellBtn').onclick = showAlerts;
  document.getElementById('ayudaBtn').onclick = (ev) => { ev.stopPropagation(); menuAyuda(ev.currentTarget, rutaActual(), ctx); };
  document.getElementById('themeBtn').onclick = toggleTheme;
  document.getElementById('userChip').onclick = userMenu;
}

function setSede(id) {
  state.sede = id;
  try { localStorage.setItem('sigpar_sede', id); } catch { /* sin almacenamiento */ }
  document.getElementById('sedeSel').value = id;
  route();
  loadAlerts();
}

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('sigpar_theme', root.dataset.theme); } catch { /* sin almacenamiento */ }
  updateThemeIcon();
  window.dispatchEvent(new Event('sigpar:theme'));
}
function updateThemeIcon() {
  document.getElementById('themeBtn').innerHTML = document.documentElement.dataset.theme === 'dark' ? icon.sun : icon.moon;
}

/** Nombre, rol y foto del usuario en la barra superior. */
function pintarUsuario() {
  const u = state.user;
  document.getElementById('userName').textContent = u.nombre;
  document.getElementById('userRole').textContent = ROLES[u.rol];
  document.getElementById('avatar').outerHTML = avatar(u).replace('class="avatar', 'id="avatar" class="avatar');
}

/** Mi perfil: nombre y foto. El correo y el rol los cambia un administrador. */
function miPerfil() {
  let foto = state.user.foto || null;
  let fotoCambio = false;
  modal({
    title: 'Mi perfil',
    body: `<div class="stack perfil">
      <div class="perfil-foto">
        <div id="pfAvatar">${avatar({ ...state.user, foto }, 'grande')}</div>
        <div class="stack" style="gap:8px">
          <label class="btn sm">${icon.camera} ${foto ? 'Cambiar foto' : 'Subir foto'}<input type="file" accept="image/*" id="pfArchivo" hidden></label>
          <button type="button" class="btn sm ghost" id="pfQuitar" ${foto ? '' : 'hidden'}>${icon.trash} Quitar foto</button>
        </div>
      </div>
      <label class="f"><span>Nombre completo</span><input class="input" name="nombre" maxlength="100" value="${esc(state.user.nombre)}"></label>
      <div class="kv-perfil small">
        <div><span class="muted">Correo</span><b>${esc(state.user.email)}</b></div>
        <div><span class="muted">Rol</span><b>${ROLES[state.user.rol]}</b></div>
      </div>
      <p class="small muted" style="margin:0">El correo y el rol los cambia un administrador. Su nombre y su foto se ven en la web, en la app y en la auditoría.</p>
    </div>`,
    onOpen: (root) => {
      const pintar = () => {
        root.querySelector('#pfAvatar').innerHTML = avatar({ ...state.user, nombre: root.querySelector('[name=nombre]').value || state.user.nombre, foto }, 'grande');
        root.querySelector('#pfQuitar').hidden = !foto;
      };
      root.querySelector('#pfArchivo').onchange = async (ev) => {
        try { foto = await fotoCuadrada(ev.target.files[0]); fotoCambio = true; pintar(); } catch (err) { fail(err); }
      };
      root.querySelector('#pfQuitar').onclick = () => { foto = null; fotoCambio = true; pintar(); };
      root.querySelector('[name=nombre]').addEventListener('input', () => { if (!foto) pintar(); });
    },
    actions: [{ label: 'Cancelar' }, {
      label: 'Guardar', cls: 'primary',
      onClick: async (close, root) => {
        const r = await api.put('/auth/perfil', { nombre: root.querySelector('[name=nombre]').value, ...(fotoCambio ? { foto } : {}) });
        state.user = r.usuario;
        auth.updateSession({ ...auth.session, usuario: r.usuario });
        pintarUsuario();
        ok('Perfil actualizado');
      },
    }],
  });
}

function userMenu(e) {
  e.stopPropagation();
  const chip = document.getElementById('userChip');
  const old = chip.querySelector('.dropdown');
  if (old) return old.remove();
  const dd = document.createElement('div');
  dd.className = 'dropdown';
  dd.innerHTML = `
    <div class="small muted" style="padding:6px 10px">${esc(state.user.email)}</div>
    <button data-a="perfil">${icon.usuarios} Mi perfil: nombre y foto</button>
    <button data-a="tema">${document.documentElement.dataset.theme === 'dark' ? icon.sun + ' Modo claro' : icon.moon + ' Modo oscuro'}</button>
    <button data-a="pass">${icon.key} Cambiar contraseña</button>
    <button data-a="out">${icon.logout} Cerrar sesión</button>`;
  chip.appendChild(dd);
  dd.onclick = (ev) => {
    ev.stopPropagation();
    const a = ev.target.closest('button')?.dataset.a;
    dd.remove();
    if (a === 'out') { auth.clear(); location.replace('index.html'); }
    if (a === 'pass') cambiarPassword();
    if (a === 'perfil') miPerfil();
    if (a === 'tema') toggleTheme();
  };
  setTimeout(() => document.addEventListener('click', () => dd.remove(), { once: true }));
}

function cambiarPassword() {
  modal({
    title: 'Cambiar contraseña',
    body: `<div class="stack">
      <label class="f"><span>Contraseña actual</span><input class="input" type="password" name="actual" autocomplete="current-password"></label>
      <label class="f"><span>Nueva contraseña (mínimo 8 caracteres)</span><input class="input" type="password" name="nueva" autocomplete="new-password"></label>
    </div>`,
    actions: [{ label: 'Cancelar' }, {
      label: 'Guardar', cls: 'primary',
      onClick: async (close, root) => { await api.post('/auth/password', formData(root)); ok('Contraseña actualizada'); },
    }],
  });
}

// ------------------------------------------------------------ Alertas de abonados
let alertas = [];
async function loadAlerts() {
  try {
    const r = await api.get('/abonados/alertas', { sede_id: ctx.sedeParam });
    alertas = r.alertas;
    const pend = alertas.length;
    const bell = document.getElementById('bellBtn');
    bell.querySelector('.dot')?.remove();
    if (pend) bell.insertAdjacentHTML('beforeend', `<span class="dot">${pend}</span>`);
    const na = document.getElementById('navAlert');
    if (na) { na.textContent = pend; na.classList.toggle('hidden', !pend); }
  } catch { /* silencioso */ }
}

function showAlerts() {
  const items = alertas.map((a) => {
    const d = Number(a.dias_restantes);
    const txt = d < 0 ? `<span class="badge red">Venció hace ${-d} d</span>` : d === 0 ? '<span class="badge red">Vence hoy</span>' : `<span class="badge orange">Vence en ${d} d</span>`;
    const wa = linkWhatsApp(a.telefono, `Hola ${a.nombre}, le recordamos que la mensualidad de su vehículo ${a.placa} en ${a.sede} ${d < 0 ? 'venció' : 'vence'} el ${fecha(a.fecha_fin)}. Puede renovarla en la sede. ¡Gracias!`);
    return `<li><div>${placa(a.placa)} <b style="margin-left:6px">${esc(a.nombre)}</b>
      <div class="small muted">${esc(a.sede)} · vence ${fecha(a.fecha_fin)}${a.telefono ? ' · ' + esc(a.telefono) : ''}</div></div>
      <div class="row" style="gap:6px;justify-content:flex-end">${txt}${wa ? `<a class="btn sm" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div></li>`;
  }).join('');
  modal({
    title: 'Alertas de mensualidades',
    body: alertas.length ? `<ul class="alert-list">${items}</ul>` : '<div class="empty">No hay abonados por vencer esta semana.</div>',
    actions: [{ label: 'Cerrar' }, { label: 'Ir a abonados', cls: 'primary', onClick: () => ctx.go('abonados') }],
  });
}

// ------------------------------------------------------------ Router
const rutaActual = () => (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'dashboard';

async function route() {
  if (state.volviendo) { state.volviendo = false; return; }
  if (state.alSalir) {
    const salir = await state.alSalir();
    if (!salir) {
      if (location.hash !== state.hash) { state.volviendo = true; location.hash = state.hash; }
      return;
    }
  }
  state.alSalir = null;
  state.hash = location.hash;
  state.timers.forEach(clearInterval);
  state.timers = [];
  state.oyentes = [];
  if (typeof state.cleanup === 'function') { try { state.cleanup(); } catch { /* ignorar */ } }
  state.cleanup = null;

  const id = rutaActual();
  const r = ROUTES.find((x) => x.id === id && x.roles.includes(state.user.rol));
  if (!r) { location.hash = '#/dashboard'; return; }

  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === id));
  document.getElementById('pageTitle').textContent = etiqueta(r, state.user.rol);
  document.title = `${etiqueta(r, state.user.rol)}, SIGPAR`;

  // Cada navegación dibuja en su propio contenedor. Si el usuario cambia de sección antes de que
  // termine de cargar, la carga anterior sigue en un contenedor desconectado y se descarta.
  const nav = ++state.nav;
  const view = document.getElementById('view');
  const cont = document.createElement('div');
  cont.className = 'vista';
  cont.innerHTML = loading();
  view.replaceChildren(cont);
  try {
    const mod = await import(`./views/${id}.js`);
    if (nav !== state.nav) return;
    cont.innerHTML = '';
    // Contexto propio de esta navegación: una vista descartada no puede dejar temporizadores activos
    const vctx = Object.create(ctx, {
      every: { value: (fn, ms) => { if (nav === state.nav) ctx.every(fn, ms); } },
      alCambiar: { value: (fn) => { if (nav === state.nav) ctx.alCambiar(fn); } },
    });
    const cleanup = await mod.default(cont, vctx);
    if (nav !== state.nav) { if (typeof cleanup === 'function') cleanup(); return; }
    state.cleanup = cleanup;
  } catch (e) {
    if (nav !== state.nav) return;
    console.error(e);
    cont.innerHTML = `<div class="alert err">No se pudo cargar esta sección: ${esc(e.message)}</div>`;
  }
}

// ------------------------------------------------------------ Tablas adaptables
/**
 * En el celular las tablas se muestran como tarjetas (ver CSS). Para eso cada celda
 * necesita la etiqueta de su columna: se copia del encabezado a data-label.
 */
function etiquetarTablas(root) {
  root.querySelectorAll('table.t').forEach((t) => {
    const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (!heads.length) return;
    t.querySelectorAll('tbody tr, tfoot tr').forEach((tr) => {
      let col = 0;
      [...tr.children].forEach((td) => {
        if (!td.hasAttribute('data-label')) {
          td.setAttribute('data-label', td.colSpan > 1 ? '' : (heads[col] ?? ''));
          // Celdas vacías o con solo un texto "sin dato" (.nada) se ocultan en la vista de tarjetas para que sean más cortas
          const nada = td.querySelector('.nada');
          if ((!td.textContent.trim() || (nada && nada.textContent.trim() === td.textContent.trim())) && !td.querySelector('button, a, input')) td.classList.add('vacio');
        }
        col += td.colSpan || 1;
      });
    });
  });
}
new MutationObserver((muts) => {
  if (muts.some((m) => m.addedNodes.length)) etiquetarTablas(document.body);
}).observe(document.body, { childList: true, subtree: true });

// ------------------------------------------------------------ Inicio
async function init() {
  renderShell();
  // Refresca la sesión (roles/sedes pudieron cambiar desde otra sesión o desde la app)
  try {
    const me = await api.get('/auth/me');
    const changed = JSON.stringify(me.sedes) !== JSON.stringify(state.sedes) || me.usuario.rol !== state.user.rol;
    state.user = me.usuario; state.sedes = me.sedes; state.empresa = me.empresa;
    auth.updateSession({ usuario: me.usuario, sedes: me.sedes, empresa: me.empresa });
    if (changed) {
      if (state.sedes.length === 1) state.sede = String(state.sedes[0].id);
      else if (!state.sedes.some((s) => String(s.id) === state.sede)) state.sede = 'all';
      renderShell();
    }
  } catch (e) { if (e.status !== 401) fail(e); }

  window.addEventListener('hashchange', route);
  route();
  loadAlerts();
  // Primera vez de este usuario: recorrido guiado por lo más importante
  if (!yaVisto('general', ctx)) setTimeout(() => iniciarTour('general', ctx), 900);
  setInterval(() => { if (!document.hidden) loadAlerts(); }, 60000);
  setInterval(vigilarCambios, 4000);
  vigilarCambios();
}

init();
