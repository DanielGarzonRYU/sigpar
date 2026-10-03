/**
 * Utilidades compartidas: política de datos (Ley 1581) y enlaces de WhatsApp (gratis, sin API).
 */
import { api } from './api.js';
import { modal, esc, fail } from './ui.js';

let politica = null;
export async function verPolitica() {
  try {
    if (politica === null) politica = (await api.get('/config')).config.politica_datos || '';
    modal({ title: 'Tratamiento de datos personales', body: `<p style="margin:0;white-space:pre-line">${esc(politica || 'La empresa no ha registrado su política de datos.')}</p>`, actions: [{ label: 'Entendido', cls: 'primary' }] });
  } catch (e) { fail(e); }
}

/** Enlace "ver política" para poner junto a la casilla de autorización. */
export const linkPolitica = '<a href="#" data-politica>ver política</a>';
export function bindPolitica(root) {
  root.querySelectorAll('[data-politica]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); verPolitica(); }));
}

/** Número colombiano → formato internacional para wa.me (3001234567 → 573001234567). */
export function numeroWhatsApp(tel) {
  const d = String(tel || '').replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('3')) return '57' + d;
  if (d.length === 12 && d.startsWith('57')) return d;
  return null;
}

export function linkWhatsApp(tel, mensaje) {
  const n = numeroWhatsApp(tel);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(mensaje)}` : null;
}
