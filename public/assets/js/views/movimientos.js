/**
 * Historial de movimientos con búsqueda, filtros, exportación y anulación.
 */
import { api } from '../api.js';
import {
  esc, money, placa, icon, TIPOS, METODOS, fechaHora, duracion, estadoMovimiento, options, vehiculo,
  diasAtrasISO, hoyISO, modal, ok, fail, toast, loading, exportExcel, exportPDF, formData,
} from '../ui.js';
import { mostrarRecibo } from '../recibo.js';

export default async function (el, ctx) {
  const esAdmin = ctx.can('superadmin', 'admin');
  const multi = ctx.sede === 'all';
  const filtros = { placa: '', estado: '', tipo: '', desde: diasAtrasISO(6), hasta: hoyISO(), page: 1, limit: 25 };

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Historial de movimientos</h1><p>${esc(ctx.sedeNombre)}. Entradas y salidas registradas desde la web y la app.</p></div>
      <div class="row">
        <button class="btn" id="xls">${icon.excel} Excel</button>
        <button class="btn" id="pdf">${icon.pdf} PDF</button>
      </div>
    </div>
    <div class="card">
      <form class="card-b row" id="filtros" style="align-items:flex-end">
        <label class="f" style="flex:1;min-width:140px"><span>Placa (o su inicio)</span><input class="input" name="placa" placeholder="ABC"></label>
        <label class="f"><span>Estado</span><select class="input" name="estado"><option value="">Todos</option>${options({ activo: 'Dentro', finalizado: 'Finalizado', anulado: 'Anulado' })}</select></label>
        <label class="f"><span>Vehículo</span><select class="input" name="tipo"><option value="">Todos</option>${options(TIPOS)}</select></label>
        <label class="f"><span>Desde</span><input class="input" type="date" name="desde" value="${filtros.desde}"></label>
        <label class="f"><span>Hasta</span><input class="input" type="date" name="hasta" value="${filtros.hasta}"></label>
        <button class="btn primary" type="submit">${icon.search} Buscar</button>
      </form>
      <div class="table-wrap" id="tabla">${loading()}</div>
      <div class="pager" id="pager"></div>
    </div>`;

  const params = (extra = {}) => ({ ...filtros, sede_id: ctx.sedeParam, ...extra });

  async function cargar() {
    const box = el.querySelector('#tabla');
    try {
      const r = await api.get('/movimientos', params());
      box.innerHTML = r.movimientos.length ? `
        <table class="t"><thead><tr>
          <th>Vehículo</th>${multi ? '<th>Sede</th>' : ''}<th>Espacio</th><th>Entrada</th><th>Salida</th><th>Tiempo</th>
          <th class="num">Cobro</th><th>Estado</th><th></th></tr></thead><tbody>
          ${r.movimientos.map((m) => `<tr>
            <td>${vehiculo(m.tipo_vehiculo, m.placa, m.propietario || m.abonado, { abonado: !!m.abonado_id })}</td>
            ${multi ? `<td>${esc(m.sede)}</td>` : ''}
            <td>${esc(m.espacio || '-')}</td>
            <td>${fechaHora(m.entrada_at)}<div class="small muted">${esc(m.usuario_entrada || '')}${m.origen === 'app' ? ' · desde la app' : ''}</div></td>
            <td>${fechaHora(m.salida_at)}<div class="small muted">${esc(m.usuario_salida || '')}</div></td>
            <td>${m.minutos ? duracion(m.minutos) : '<span class="muted nada">En curso</span>'}</td>
            <td class="num">${m.valor !== null ? `<b>${money(m.valor)}</b><div class="small muted">${METODOS[m.metodo_pago] || ''}</div>` : '<span class="muted nada">Sin cobro</span>'}</td>
            <td>${estadoMovimiento(m.estado)}${m.observacion ? `<div class="small muted" title="${esc(m.observacion)}">${esc(m.observacion.slice(0, 40))}</div>` : ''}</td>
            <td class="right" style="white-space:nowrap">
              ${m.estado !== 'anulado' ? `<button class="btn sm" data-rec="${m.id}">${icon.print} ${m.estado === 'finalizado' ? 'Recibo' : 'Tiquete'}</button>` : ''}
              ${esAdmin && m.estado !== 'anulado' ? `<button class="btn sm ghost" data-anular="${m.id}" data-placa="${esc(m.placa)}" title="Anular registro">Anular</button>` : ''}
            </td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">No hay movimientos con esos filtros.</div>';

      const pages = Math.max(1, Math.ceil(r.total / r.limit));
      el.querySelector('#pager').innerHTML = `
        <span class="small muted">${r.total} registro(s) · página ${r.page} de ${pages}</span>
        <div class="row"><button class="btn sm" id="prev" ${r.page <= 1 ? 'disabled' : ''}>Anterior</button>
        <button class="btn sm" id="next" ${r.page >= pages ? 'disabled' : ''}>Siguiente</button></div>`;
      el.querySelector('#prev').onclick = () => { filtros.page--; cargar(); };
      el.querySelector('#next').onclick = () => { filtros.page++; cargar(); };
      box.querySelectorAll('[data-rec]').forEach((b) => b.onclick = () => mostrarRecibo(b.dataset.rec));
      box.querySelectorAll('[data-anular]').forEach((b) => b.onclick = () => anular(b.dataset.anular, b.dataset.placa));
    } catch (e) { box.innerHTML = `<div class="alert err" style="margin:16px">${esc(e.message)}</div>`; }
  }

  function anular(id, pl) {
    modal({
      title: `Anular movimiento #${id}`,
      body: `<div class="stack"><div class="alert warn">La anulación de ${placa(pl)} queda registrada en auditoría con su usuario. Úsela solo para corregir errores.</div>
        <label class="f"><span>Motivo</span><textarea class="input" name="motivo" rows="3" maxlength="200"></textarea></label></div>`,
      actions: [{ label: 'Cancelar' }, {
        label: 'Anular', cls: 'danger',
        onClick: async (c, root) => { await api.post(`/movimientos/${id}/anular`, formData(root)); ok('Movimiento anulado'); cargar(); },
      }],
    });
  }

  el.querySelector('#filtros').onsubmit = (e) => {
    e.preventDefault();
    Object.assign(filtros, formData(e.target), { page: 1 });
    cargar();
  };

  const cols = [
    { h: 'ID', v: (m) => m.id, num: true }, { h: 'Placa', v: (m) => m.placa }, { h: 'Tipo', v: (m) => TIPOS[m.tipo_vehiculo] },
    { h: 'Sede', v: (m) => m.sede }, { h: 'Espacio', v: (m) => m.espacio || '' },
    { h: 'Entrada', v: (m) => m.entrada_at }, { h: 'Salida', v: (m) => m.salida_at || '' },
    { h: 'Minutos', v: (m) => m.minutos ?? '', num: true }, { h: 'Valor', v: (m) => Number(m.valor || 0), money: true },
    { h: 'Pago', v: (m) => METODOS[m.metodo_pago] || '' }, { h: 'Estado', v: (m) => ({ activo: 'Dentro', finalizado: 'Finalizado', anulado: 'Anulado' }[m.estado] || m.estado) },
    { h: 'Origen', v: (m) => (m.origen === 'app' ? 'App' : 'Web') },
    { h: 'Operador salida', v: (m) => m.usuario_salida || '' },
  ];
  const colsPdf = cols.filter((c) => !['ID', 'Origen'].includes(c.h));
  // Exportación: hasta 5.000 filas; si hay más, se avisa para que acote las fechas (nunca se corta en silencio)
  const todo = async () => {
    const r = await api.get('/movimientos', params({ page: 1, limit: 5000 }));
    if (r.total > r.movimientos.length) toast(`Se exportan los ${r.movimientos.length} registros más recientes de ${r.total}. Acote las fechas para exportar el resto.`);
    return r.movimientos;
  };
  const nombre = () => `sigpar-movimientos-${filtros.desde}_${filtros.hasta}`;
  el.querySelector('#xls').onclick = async () => { try { exportExcel(nombre(), cols, await todo(), 'Movimientos'); } catch (e) { fail(e); } };
  el.querySelector('#pdf').onclick = async () => {
    try {
      const filas = await todo();
      const total = filas.filter((m) => m.estado === 'finalizado').reduce((s, m) => s + Number(m.valor || 0), 0);
      exportPDF(nombre(), 'Historial de movimientos', `${ctx.sedeNombre} · ${filtros.desde} a ${filtros.hasta} · ${filas.length} registros`,
        colsPdf, filas, { horizontal: true, pie: colsPdf.map((c, i) => (c.h === 'Valor' ? money(total) : colsPdf[i + 1]?.h === 'Valor' ? 'Total cobrado' : '')) });
    } catch (e) { fail(e); }
  };

  await cargar();
  // Entradas, salidas y anulaciones de otros equipos (la app, otro operador) aparecen sin recargar
  ctx.alCambiar(cargar);
}
