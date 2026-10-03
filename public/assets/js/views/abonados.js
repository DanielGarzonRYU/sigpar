/**
 * Abonados (mensualidades) con alertas de vencimiento (OE3).
 */
import { api } from '../api.js';
import {
  esc, money, icon, TIPOS, METODOS, fecha, fechaHora, estadoAbonado, options, hoyISO,
  modal, ok, fail, loading, formData, exportExcel, confirmar, vehiculo,
} from '../ui.js';
import { linkPolitica, bindPolitica, linkWhatsApp } from '../extras.js';

export default async function (el, ctx) {
  const esAdmin = ctx.can('superadmin', 'admin');
  const multi = ctx.sede === 'all';
  let filtro = { q: '', estado: '' };
  let lista = [];

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Abonados</h1><p>${esc(ctx.sedeNombre)}. Clientes con mensualidad. Cada mensualidad es válida en la sede donde se inscribió.</p></div>
      <div class="row">
        ${esAdmin ? `<button class="btn" id="notif">${icon.mail} Avisar por correo</button>` : ''}
        ${esAdmin ? `<button class="btn" id="xls">${icon.excel} Excel</button>` : ''}
        <button class="btn primary" id="nuevo">${icon.plus} Nuevo abonado</button>
      </div>
    </div>
    <!-- Las tarjetas del resumen son también los filtros (antes había botones de filtro que repetían lo mismo) -->
    <div class="grid g4 filtro-kpis" id="resumen" style="margin-bottom:16px"></div>
    <div class="card">
      <div class="card-b row">
        <input class="input" id="q" type="search" placeholder="Buscar por nombre, placa o documento" style="flex:1;min-width:200px">
        <span class="small muted" id="filtroTxt"></span>
      </div>
      <div class="table-wrap" id="tabla">${loading()}</div>
    </div>`;

  async function cargar() {
    try {
      const r = await api.get('/abonados', { sede_id: ctx.sedeParam });
      lista = r.abonados;
      pintar();
    } catch (e) { el.querySelector('#tabla').innerHTML = `<div class="alert err" style="margin:16px">${esc(e.message)}</div>`; }
  }

  function pintar() {
    const c = (e) => lista.filter((a) => a.estado === e).length;
    const tarjeta = (e, etiqueta, valor, sub, color) => `
      <button class="card kpi filtro ${filtro.estado === e ? 'on' : ''}" data-e="${e}" aria-pressed="${filtro.estado === e}">
        <div class="label">${color ? `<span class="sw" style="background:${color}"></span>` : ''}${etiqueta}</div>
        <div class="value">${valor}</div><div class="sub">${sub}</div></button>`;
    el.querySelector('#resumen').innerHTML =
      tarjeta('', 'Todos', lista.length, c('inactivo') ? `${c('inactivo')} inactivo(s): <span class="enlace" data-e="inactivo">verlos</span>` : 'Inscritos en total')
      + tarjeta('vigentes', 'Vigentes', c('vigente') + c('por_vencer'), 'Al día con su mensualidad', 'var(--libre)')
      + tarjeta('por_vencer', 'Por vencer', c('por_vencer'), 'Avíseles para que renueven', 'var(--reservado)')
      + tarjeta('vencido', 'Vencidos', c('vencido'), 'Pagan por tiempo hasta renovar', 'var(--ocupado)');
    el.querySelectorAll('#resumen [data-e]').forEach((b) => b.onclick = (ev) => {
      ev.stopPropagation();
      filtro.estado = filtro.estado === b.dataset.e && b.dataset.e ? '' : b.dataset.e;
      pintar();
    });
    const nombresFiltro = { vigentes: 'vigentes', por_vencer: 'por vencer', vencido: 'vencidos', inactivo: 'inactivos' };
    el.querySelector('#filtroTxt').innerHTML = filtro.estado ? `Mostrando ${nombresFiltro[filtro.estado]} · <button class="link" id="verTodos">ver todos</button>` : 'Toque una tarjeta para filtrar';
    el.querySelector('#verTodos')?.addEventListener('click', () => { filtro.estado = ''; pintar(); });

    const q = filtro.q.toLowerCase();
    const cumple = (a) => !filtro.estado || a.estado === filtro.estado || (filtro.estado === 'vigentes' && ['vigente', 'por_vencer'].includes(a.estado));
    const filas = lista.filter((a) => cumple(a)
      && (!q || [a.nombre, a.placa, a.documento].some((x) => String(x || '').toLowerCase().includes(q))));
    el.querySelector('#tabla').innerHTML = filas.length ? `
      <table class="t"><thead><tr><th>Placa</th><th>Abonado</th>${multi ? '<th>Sede</th>' : ''}<th>Contacto</th><th>Periodo</th><th>Estado</th><th></th></tr></thead><tbody>
      ${filas.map((a) => `<tr>
        <td>${vehiculo(a.tipo_vehiculo, a.placa, null)}</td>
        <td><b>${esc(a.nombre)}</b><div class="small muted">${esc(a.documento || '')}</div></td>
        ${multi ? `<td>${esc(a.sede)}</td>` : ''}
        <td class="small">${esc(a.telefono || 'Sin teléfono')}<div class="muted">${esc(a.email || '')}</div></td>
        <td class="small">${fecha(a.fecha_inicio)} → <b>${fecha(a.fecha_fin)}</b></td>
        <td>${estadoAbonado(a.estado, a.dias_restantes)}</td>
        <td class="right" style="white-space:nowrap">
          <button class="btn sm success" data-ren="${a.id}">Renovar</button>
          ${['por_vencer', 'vencido'].includes(a.estado) && linkWhatsApp(a.telefono, '') ? `<a class="btn sm" target="_blank" rel="noopener" title="Recordar por WhatsApp" href="${linkWhatsApp(a.telefono, `Hola ${a.nombre}, le recordamos que la mensualidad de su vehículo ${a.placa} en ${a.sede} ${a.estado === 'vencido' ? 'venció' : 'vence'} el ${fecha(a.fecha_fin)}. Puede renovarla en la sede. ¡Gracias!`)}">WhatsApp</a>` : ''}
          <button class="btn sm ghost" data-ver="${a.id}" title="Detalle y pagos">${icon.historial}</button>
          ${esAdmin ? `<button class="btn sm ghost" data-edit="${a.id}" title="Editar">${icon.edit}</button>` : ''}
        </td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">No hay abonados con ese filtro.</div>';

    const find = (id) => lista.find((a) => a.id == id);
    el.querySelectorAll('[data-ren]').forEach((b) => b.onclick = () => renovar(find(b.dataset.ren)));
    el.querySelectorAll('[data-ver]').forEach((b) => b.onclick = () => detalle(find(b.dataset.ver)));
    el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => editar(find(b.dataset.edit)));
  }

  // ------------------------------------------------------------- Formularios
  async function nuevo() {
    const sedes = ctx.sedeId ? ctx.sedes.filter((s) => s.id === ctx.sedeId) : ctx.sedes;
    const tarifas = (await api.get('/tarifas', { sede_id: ctx.sedeParam })).tarifas;
    const valorDe = (sede, tipo, meses) => (Number(tarifas.find((t) => t.sede_id == sede && t.tipo_vehiculo === tipo)?.valor_mensualidad || 0) * meses);

    modal({
      title: 'Nuevo abonado',
      body: `<div class="form-grid">
        <label class="f"><span>Sede</span><select class="input" name="sede_id">${sedes.map((s) => `<option value="${s.id}">${esc(s.nombre)}</option>`).join('')}</select></label>
        <label class="f"><span>Placa</span><input class="input mono" name="placa" maxlength="8" style="text-transform:uppercase"></label>
        <label class="f"><span>Nombre completo</span><input class="input" name="nombre" maxlength="120"></label>
        <label class="f"><span>Documento</span><input class="input" name="documento" maxlength="30"></label>
        <label class="f"><span>Teléfono</span><input class="input" name="telefono" maxlength="30"></label>
        <label class="f"><span>Correo (para avisos)</span><input class="input" type="email" name="email" maxlength="150"></label>
        <label class="f"><span>Tipo de vehículo</span><select class="input" name="tipo_vehiculo">${options(TIPOS)}</select></label>
        <label class="f"><span>Inicio</span><input class="input" type="date" name="fecha_inicio" value="${hoyISO()}"></label>
        <label class="f"><span>Meses</span><select class="input" name="meses">${[1, 2, 3, 6, 12].map((m) => `<option>${m}</option>`).join('')}</select></label>
        <label class="f"><span>Método de pago</span><select class="input" name="metodo_pago">${options({ efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', app: 'App / QR' })}</select></label>
        <label class="f full"><span>Valor a pagar${esAdmin ? ' (puede ajustarlo para un descuento)' : ' (tarifa de la sede)'}</span><input class="input" type="number" name="valor" min="0" step="100" ${esAdmin ? '' : 'readonly'}></label>
        <label class="check full"><input type="checkbox" name="autoriza_datos"><span>El cliente autoriza el tratamiento de sus datos personales conforme a la Ley 1581 de 2012 (obligatorio · ${linkPolitica}).</span></label>
      </div>`,
      onOpen: (root) => {
        bindPolitica(root);
        const upd = () => { root.querySelector('[name=valor]').value = valorDe(root.querySelector('[name=sede_id]').value, root.querySelector('[name=tipo_vehiculo]').value, +root.querySelector('[name=meses]').value); };
        ['sede_id', 'tipo_vehiculo', 'meses'].forEach((n) => root.querySelector(`[name=${n}]`).addEventListener('change', upd));
        upd();
      },
      actions: [{ label: 'Cancelar' }, {
        label: 'Inscribir y cobrar', cls: 'primary',
        onClick: async (c, root) => {
          const d = formData(root);
          const r = await api.post('/abonados', d);
          ok(`Abonado inscrito hasta ${r.fecha_fin} · ${money(r.valor)}`);
          cargar(); ctx.refreshAlerts();
        },
      }],
    });
  }

  function renovar(a) {
    modal({
      title: `Renovar mensualidad · ${a.placa}`,
      body: `<div class="stack">
        <p style="margin:0">${esc(a.nombre)} · vence <b>${fecha(a.fecha_fin)}</b>. El nuevo periodo empieza al día siguiente del vencimiento (o hoy si ya venció).</p>
        <div class="form-grid">
          <label class="f"><span>Meses</span><select class="input" name="meses">${[1, 2, 3, 6, 12].map((m) => `<option>${m}</option>`).join('')}</select></label>
          <label class="f"><span>Método de pago</span><select class="input" name="metodo_pago">${options({ efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', app: 'App / QR' })}</select></label>
          ${esAdmin ? '<label class="f full"><span>Valor (vacío = tarifa de la sede; úselo solo para descuentos)</span><input class="input" type="number" name="valor" min="0" step="100"></label>' : '<p class="small muted full" style="margin:0">Se cobra la mensualidad según la tarifa de la sede.</p>'}
        </div></div>`,
      actions: [{ label: 'Cancelar' }, {
        label: 'Renovar', cls: 'success',
        onClick: async (c, root) => {
          const r = await api.post(`/abonados/${a.id}/renovar`, formData(root));
          ok(`Renovado hasta ${r.fecha_fin} · ${money(r.valor)}`);
          cargar(); ctx.refreshAlerts();
        },
      }],
    });
  }

  function editar(a) {
    modal({
      title: `Editar abonado · ${a.placa}`,
      body: `<div class="form-grid">
        <label class="f"><span>Nombre</span><input class="input" name="nombre" value="${esc(a.nombre)}"></label>
        <label class="f"><span>Placa</span><input class="input mono" name="placa" value="${esc(a.placa)}"></label>
        <label class="f"><span>Documento</span><input class="input" name="documento" value="${esc(a.documento || '')}"></label>
        <label class="f"><span>Teléfono</span><input class="input" name="telefono" value="${esc(a.telefono || '')}"></label>
        <label class="f"><span>Correo</span><input class="input" name="email" value="${esc(a.email || '')}"></label>
        <label class="f"><span>Vehículo</span><select class="input" name="tipo_vehiculo">${options(TIPOS, a.tipo_vehiculo)}</select></label>
      </div>`,
      actions: [
        { label: a.activo == 1 ? 'Desactivar' : 'Activar', cls: a.activo == 1 ? 'danger' : '', onClick: async () => {
          if (a.activo == 1 && !(await confirmar('Desactivar abonado', 'Dejará de reconocerse como abonado al ingresar.', { cls: 'danger', label: 'Desactivar' }))) return false;
          await api.patch(`/abonados/${a.id}/estado`, { activo: a.activo != 1 }); ok('Estado actualizado'); cargar(); ctx.refreshAlerts();
        } },
        { label: 'Cancelar' },
        { label: 'Guardar', cls: 'primary', onClick: async (c, root) => { await api.put(`/abonados/${a.id}`, formData(root)); ok('Abonado actualizado'); cargar(); } },
      ],
    });
  }

  async function detalle(a) {
    try {
      const r = await api.get(`/abonados/${a.id}`);
      modal({
        title: `${a.nombre} · ${a.placa}`,
        wide: true,
        body: `<dl class="kv" style="margin-bottom:16px">
            <dt>Sede</dt><dd>${esc(a.sede)}</dd><dt>Vehículo</dt><dd>${TIPOS[a.tipo_vehiculo]}</dd>
            <dt>Vigencia</dt><dd>${fecha(a.fecha_inicio)} → ${fecha(a.fecha_fin)}</dd><dt>Estado</dt><dd>${estadoAbonado(a.estado, a.dias_restantes)}</dd>
            <dt>Autorizó datos</dt><dd>${a.autoriza_datos == 1 ? 'Sí (Ley 1581)' : 'No'}</dd></dl>
          <h3 style="margin-bottom:8px">Pagos</h3>
          <div class="table-wrap"><table class="t"><thead><tr><th>Fecha</th><th>Periodo</th><th>Método</th><th>Registró</th><th class="num">Valor</th></tr></thead><tbody>
          ${r.pagos.map((p) => `<tr><td>${fechaHora(p.created_at)}</td><td>${fecha(p.periodo_inicio)} → ${fecha(p.periodo_fin)}</td><td>${METODOS[p.metodo_pago]}</td><td>${esc(p.usuario || '-')}</td><td class="num">${money(p.valor)}</td></tr>`).join('')}
          </tbody></table></div>`,
        actions: [{ label: 'Cerrar' }],
      });
    } catch (e) { fail(e); }
  }

  // ------------------------------------------------------------- Eventos
  el.querySelector('#nuevo').onclick = () => nuevo().catch(fail);
  el.querySelector('#q').oninput = (e) => { filtro.q = e.target.value; pintar(); };
  el.querySelector('#xls')?.addEventListener('click', () => exportExcel('sigpar-abonados', [
    { h: 'Placa', v: (a) => a.placa }, { h: 'Nombre', v: (a) => a.nombre }, { h: 'Documento', v: (a) => a.documento || '' },
    { h: 'Teléfono', v: (a) => a.telefono || '' }, { h: 'Correo', v: (a) => a.email || '' }, { h: 'Sede', v: (a) => a.sede },
    { h: 'Vehículo', v: (a) => TIPOS[a.tipo_vehiculo] }, { h: 'Inicio', v: (a) => a.fecha_inicio }, { h: 'Fin', v: (a) => a.fecha_fin },
    { h: 'Estado', v: (a) => a.estado },
  ], lista, 'Abonados'));
  el.querySelector('#notif')?.addEventListener('click', async () => {
    if (!(await confirmar('Avisar por correo', 'Se enviará un correo a los abonados por vencer que tengan correo registrado.'))) return;
    try { const r = await api.post('/abonados/notificar', { sede_id: ctx.sedeParam }); ok(`Correos enviados: ${r.enviados} de ${r.candidatos}`); } catch (e) { fail(e); }
  });

  await cargar();
  ctx.alCambiar(() => { if (!(document.activeElement?.matches('input') && el.contains(document.activeElement))) return cargar(); });
}
