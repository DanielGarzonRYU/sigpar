/**
 * Utilidades de interfaz: formato, íconos, toasts, modales, exportación.
 */
import { PHOSPHOR } from './iconos.js';

// ------------------------------------------------------------------ Formato
const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('es-CO');
export const money = (v) => cop.format(Number(v) || 0);
export const n = (v) => num.format(Number(v) || 0);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// "2026-09-29" sola se interpretaría en UTC (mostraría el día anterior en Colombia): se fuerza hora local.
const toDate = (s) => (s instanceof Date ? s : new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : String(s).replace(' ', 'T')));
export const fecha = (s) => (s ? toDate(s).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Sin fecha');
export const fechaHora = (s) => (s ? toDate(s).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Sin fecha');
export const hora = (s) => (s ? toDate(s).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : 'Sin hora');
/** Hora si es de hoy; si no, fecha corta y hora ("29 sept, 03:42 p. m."): así no se confunde un vehículo de hace días. */
export const momento = (s) => {
  if (!s) return 'Sin hora';
  const d = toDate(s);
  return d.toDateString() === new Date().toDateString() ? hora(s) : `${d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}, ${hora(s)}`;
};
export const hoyISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
export const diasAtrasISO = (dias) => { const d = new Date(Date.now() - dias * 864e5); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

export function duracion(min) {
  min = Math.max(0, Math.round(Number(min) || 0));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m} min`;
}
export const minutosDesde = (s, ahora = Date.now()) => Math.max(0, Math.round((ahora - toDate(s).getTime()) / 60000));
export const placa = (p) => `<span class="plate-tag">${esc(p)}</span>`;
/**
 * Vehículo en tablas y listas: ícono del tipo, placa y nombre del propietario.
 * Sin nombre registrado se muestra el tipo (Carro, Moto...), para no llenar la tabla de "sin dato".
 */
export function vehiculo(tipo, pl, nombre, { abonado = false } = {}) {
  return `<div class="veh"><span class="veh-ic tipo-${esc(tipo)}" title="${TIPOS[tipo] || ''}">${icon[tipo] || ''}</span>
    <div class="veh-txt"><div class="veh-fila">${placa(pl)}${abonado ? '<span class="badge blue">Abonado</span>' : ''}</div>
    <div class="small ${nombre ? 'veh-nombre' : 'muted'}">${nombre ? esc(nombre) : TIPOS[tipo] || ''}</div></div></div>`;
}
/** Iniciales para el avatar cuando no hay foto ("Laura Gómez" → "LG"). */
export const iniciales = (nombre) => String(nombre || '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

/** Avatar de un usuario: su foto o, si no tiene, sus iniciales. */
export function avatar(u, clase = '') {
  return u?.foto
    ? `<span class="avatar con-foto ${clase}"><img src="${esc(u.foto)}" alt=""></span>`
    : `<span class="avatar ${clase}">${esc(iniciales(u?.nombre))}</span>`;
}

/** Recorta la imagen al centro en un cuadrado de `lado` px y la devuelve como JPG liviano (data URL). */
export async function fotoCuadrada(file, lado = 256) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Elija una imagen JPG o PNG');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('No se pudo abrir la imagen. Use una foto JPG o PNG.'));
      i.src = url;
    });
    const m = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = c.height = lado;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, lado, lado);
    g.drawImage(img, (img.naturalWidth - m) / 2, (img.naturalHeight - m) / 2, m, m, 0, 0, lado, lado);
    return c.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}
export const normalizarPlaca = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const TIPOS = { carro: 'Carro', moto: 'Moto', bicicleta: 'Bicicleta' };
export const METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', app: 'App / QR', abonado: 'Abonado' };
export const ROLES = { superadmin: 'Superadministrador', admin: 'Administrador', operador: 'Operador' };

// -------------------------------------------------------------------- Íconos
// Una sola familia (Phosphor, trazo regular) para todo el panel.
const ph = (nombre) => `<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${PHOSPHOR[nombre]}</svg>`;
const MAPA = {
  dashboard: 'squares-four', operacion: 'arrows-left-right', historial: 'clock-counter-clockwise', abonados: 'users-three',
  reportes: 'chart-bar', espacios: 'grid-nine', tarifas: 'currency-circle-dollar', sedes: 'buildings', usuarios: 'user-gear',
  auditoria: 'shield-check', config: 'gear-six', bell: 'bell', menu: 'list', sun: 'sun', moon: 'moon', logout: 'sign-out',
  key: 'key', plus: 'plus', x: 'x', in: 'sign-in', out: 'sign-out', carro: 'car-profile', moto: 'motorcycle', bicicleta: 'bicycle',
  print: 'printer', excel: 'file-xls', pdf: 'file-pdf', search: 'magnifying-glass', edit: 'pencil-simple', refresh: 'arrows-clockwise',
  mail: 'envelope-simple', camera: 'camera', warning: 'warning', check: 'check-circle', info: 'info', caja: 'cash-register',
  lock: 'lock-simple', pin: 'map-pin', offline: 'cloud-slash',
  plano: 'map-trifold', cursor: 'cursor', borrar: 'eraser', undo: 'arrow-counter-clockwise', girar: 'arrow-clockwise',
  texto: 'text-t', puerta: 'door-open', arbol: 'tree', ayuda: 'question', zoomIn: 'magnifying-glass-plus',
  zoomOut: 'magnifying-glass-minus', columna: 'square', muro: 'wall', idea: 'lightbulb', flecha: 'arrow-right',
  caseta: 'storefront', guardar: 'floppy-disk', trash: 'trash', tap: 'hand-tap', magia: 'sparkle', via: 'arrows-left-right',
  imagen: 'image', subir: 'upload-simple', describir: 'chat-text', listo: 'check', atras: 'arrow-left', moverTodo: 'arrows-out-cardinal', ver: 'eye', cubo: 'cube',
};
export const icon = Object.fromEntries(Object.entries(MAPA).map(([k, v]) => [k, ph(v)]));

// ---------------------------------------------------------------- Badges
export function estadoEspacio(e) {
  const m = { disponible: 'green', ocupado: 'red', reservado: 'orange', inactivo: 'gray' };
  const t = { disponible: 'Disponible', ocupado: 'Ocupado', reservado: 'Reservado', inactivo: 'Inactivo' };
  return `<span class="badge ${m[e] || ''}">${t[e] || esc(e)}</span>`;
}
export function estadoMovimiento(e) {
  const m = { activo: ['blue', 'Dentro'], finalizado: ['green', 'Finalizado'], anulado: ['gray', 'Anulado'] };
  const [c, t] = m[e] || ['', e];
  return `<span class="badge ${c}">${t}</span>`;
}
export function estadoAbonado(e, dias) {
  const m = { vigente: ['green', 'Vigente'], por_vencer: ['orange', `Vence en ${dias} d`], vencido: ['red', 'Vencido'], inactivo: ['gray', 'Inactivo'], programado: ['blue', 'Programado'] };
  const [c, t] = m[e] || ['', e];
  return `<span class="badge ${c}">${esc(t)}</span>`;
}

// ---------------------------------------------------------------- Toasts
let toastBox;
export function toast(msg, type = '') {
  if (!toastBox) {
    toastBox = document.createElement('div'); toastBox.className = 'toasts';
    toastBox.setAttribute('role', 'status'); toastBox.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastBox);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = (type === 'ok' ? icon.check : type === 'err' ? icon.warning : '') + `<span>${esc(msg)}</span>`;
  toastBox.appendChild(t);
  // Sale por el mismo lado por el que entró; si el navegador no anima, se quita igual.
  setTimeout(() => {
    t.classList.add('saliendo');
    t.addEventListener('transitionend', () => t.remove(), { once: true });
    setTimeout(() => t.remove(), 400);
  }, type === 'err' ? 6000 : 3500);
}
export const ok = (m) => toast(m, 'ok');
export const fail = (e) => toast(e?.message || String(e), 'err');

// ---------------------------------------------------------------- Modales
/**
 * modal({ title, body, wide, actions: [{label, cls, onClick(close, root) -> false para no cerrar}] })
 */
export function modal({ title, body, wide = false, actions = [], onOpen }) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal-h"><h2>${esc(title)}</h2><button class="icon-btn" data-x aria-label="Cerrar">${icon.x}</button></div>
        <div class="modal-b">${body}</div>
        ${actions.length ? '<div class="modal-f"></div>' : ''}
      </div>`;
    const close = (v) => { bg.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(null); });
    bg.querySelector('[data-x]').onclick = () => close(null);
    const foot = bg.querySelector('.modal-f');
    actions.forEach((a) => {
      const b = document.createElement('button');
      b.className = `btn ${a.cls || ''}`;
      b.innerHTML = a.label;
      b.onclick = async () => {
        if (!a.onClick) return close(a.value ?? null);
        b.disabled = true;
        try {
          const r = await a.onClick(close, bg);
          if (r !== false) close(r ?? true);
        } catch (e) { fail(e); } finally { b.disabled = false; }
      };
      foot.appendChild(b);
    });
    document.body.appendChild(bg);
    const first = bg.querySelector('input:not([type=hidden]):not([type=checkbox]), select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
    onOpen?.(bg, close);
  });
}

export function confirmar(title, text, { label = 'Confirmar', cls = 'primary' } = {}) {
  return modal({ title, body: `<p style="margin:0">${text}</p>`, actions: [{ label: 'Cancelar', value: false }, { label, cls, value: true }] });
}

/** Lee un formulario como objeto (checkbox → boolean). */
export function formData(root) {
  const out = {};
  root.querySelectorAll('[name]').forEach((el) => {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.multiple) out[el.name] = [...el.selectedOptions].map((o) => o.value);
    else out[el.name] = el.value.trim();
  });
  return out;
}

/** Esqueleto de carga: filas con la forma del contenido que viene (no un círculo girando). */
export const loading = (filas = 4) => `<div class="loading" aria-busy="true" aria-label="Cargando">${'<div class="sk sk-line"></div>'.repeat(Number(filas) || 4)}</div>`;
/** Esqueleto de un tablero: indicadores arriba y un bloque grande. */
export const loadingTablero = () => `<div class="loading" aria-busy="true" aria-label="Cargando"><div class="sk-row">${'<div class="sk sk-kpi"></div>'.repeat(4)}</div><div class="sk sk-block"></div></div>`;
export const vacio = (text) => `<div class="empty">${text}</div>`;

export function options(obj, selected) {
  return Object.entries(obj).map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(selected) ? 'selected' : ''}>${esc(t)}</option>`).join('');
}

// ------------------------------------------------------------- Exportación
/** columnas: [{ h: 'Encabezado', v: (fila) => valor, money?: true }] */
// Las librerías de Excel (880 KB) y PDF (400 KB) solo se descargan la primera vez que se exporta:
// así el panel carga rápido en el celular del operador, que casi nunca exporta.
const scripts = {};
function cargarScript(src) {
  scripts[src] ??= new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => { delete scripts[src]; mal(new Error('No se pudo descargar ' + src.split('/').pop())); };
    document.head.appendChild(s);
  });
  return scripts[src];
}

export async function exportExcel(nombre, columnas, filas, hoja = 'Reporte') {
  try { await cargarScript('assets/vendor/xlsx.full.min.js'); } catch (e) { return fail(e); }
  if (!window.XLSX) return fail('No se pudo cargar la librería de Excel');
  const data = [columnas.map((c) => c.h), ...filas.map((f) => columnas.map((c) => c.v(f)))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = columnas.map((c) => ({ wch: Math.max(c.h.length + 2, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, hoja.slice(0, 31));
  XLSX.writeFile(wb, `${nombre}.xlsx`);
}

export async function exportPDF(nombre, titulo, subtitulo, columnas, filas, { horizontal = false, pie } = {}) {
  try {
    await cargarScript('assets/vendor/jspdf.umd.min.js');
    await cargarScript('assets/vendor/jspdf.plugin.autotable.min.js');
  } catch (e) { return fail(e); }
  const lib = window.jspdf;
  if (!lib) return fail('No se pudo cargar la librería de PDF');
  const doc = new lib.jsPDF({ orientation: horizontal ? 'landscape' : 'portrait', unit: 'pt', format: 'letter' });
  doc.setFontSize(16); doc.setTextColor(22, 23, 26); doc.text('SIGPAR', 40, 44);
  doc.setFillColor(242, 194, 0); doc.rect(40, 50, 44, 3, 'F');
  doc.setFontSize(13); doc.setTextColor(20); doc.text(titulo, 40, 64);
  doc.setFontSize(9); doc.setTextColor(110); doc.text(subtitulo.replace(/·/g, '|'), 40, 80);
  doc.autoTable({
    startY: 94,
    head: [columnas.map((c) => c.h)],
    body: filas.map((f) => columnas.map((c) => (c.money ? money(c.v(f)) : String(c.v(f) ?? '')))),
    foot: pie ? [pie] : undefined,
    showFoot: 'lastPage', // el total solo al final del documento
    showHead: 'everyPage',
    styles: { fontSize: 8.5, cellPadding: 5 },
    headStyles: { fillColor: [22, 23, 26], textColor: [242, 194, 0] },
    footStyles: { fillColor: [239, 239, 236], textColor: 20, fontStyle: 'bold' },
    columnStyles: Object.fromEntries(columnas.map((c, i) => [i, c.money || c.num ? { halign: 'right' } : {}])),
  });
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(140);
    doc.text(`Generado ${new Date().toLocaleString('es-CO')}, página ${i} de ${pages}`, 40, doc.internal.pageSize.getHeight() - 20);
  }
  doc.save(`${nombre}.pdf`);
}
