/**
 * Para vistas que trabajan sobre UNA sede: si el selector global está en "Todas",
 * se muestra un selector local.
 */
import { esc } from './ui.js';

export function sedeLocal(ctx, key) {
  let id = ctx.sedeId;
  if (!id) {
    try { id = Number(sessionStorage.getItem(key)) || null; } catch { id = null; }
    if (!ctx.sedes.some((s) => s.id === id)) id = ctx.sedes[0]?.id ?? null;
  }
  return {
    get id() { return id; },
    set(v) { id = Number(v); try { sessionStorage.setItem(key, String(id)); } catch { /* sin almacenamiento */ } },
    /** HTML del selector (vacío si ya hay una sede fija). */
    html() {
      if (ctx.sedeId) return '';
      return `<label class="f row" style="gap:8px"><span style="margin:0">Sede</span>
        <select class="input" data-sede-local style="width:auto">${ctx.sedes.map((s) => `<option value="${s.id}" ${s.id === id ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('')}</select></label>`;
    },
    bind(root, onChange) {
      root.querySelector('[data-sede-local]')?.addEventListener('change', (e) => { this.set(e.target.value); onChange(); });
    },
    get nombre() { return ctx.sedes.find((s) => s.id === id)?.nombre || ''; },
  };
}
