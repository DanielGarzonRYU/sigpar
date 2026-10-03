/**
 * Configuración de espacios por sede.
 */
import { api } from '../api.js';
import { esc, icon, TIPOS, options, estadoEspacio, modal, confirmar, ok, fail, loading, formData, vehiculo } from '../ui.js';
import { sedeLocal } from '../sede.js';

export default async function (el, ctx) {
  const sede = sedeLocal(ctx, 'sigpar_esp_sede');
  if (!sede.id) { el.innerHTML = '<div class="alert warn">Primero cree una sede.</div>'; return; }
  let espacios = [];

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Espacios</h1><p>Puestos de parqueo de cada sede. Los cambios se ven al instante en la app del operador.</p></div>
      <div class="row">${sede.html()}
        <button class="btn" id="lote">${icon.plus} Crear varios</button>
        <button class="btn primary" id="uno">${icon.plus} Nuevo espacio</button></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-h"><h3>Capacidad de la sede</h3><span class="small muted">¿Cuántos vehículos caben? Ajuste el número y el sistema crea o retira los espacios.</span></div>
      <div class="card-b">
        <div class="grid g4" id="res"></div>
        <div class="row" style="justify-content:space-between;margin-top:14px">
          <span class="small muted">Nunca se retiran espacios ocupados ni reservados. Los que tienen historial se inhabilitan en lugar de borrarse.</span>
          <button class="btn primary" id="aplicarCap">Aplicar capacidad</button>
        </div>
      </div>
    </div>
    <div class="card"><div class="card-h"><h3>Detalle de espacios</h3><span class="small muted">Puede renombrar códigos (ej. "Sótano-12") o agregar notas.</span></div>
      <div class="card-b row esp-filtros">
        <input class="input" id="qEsp" type="search" placeholder="Buscar código, placa o nombre" style="flex:1;min-width:180px" autocomplete="off">
        <div class="seg" id="fTipo"><button data-t="" class="on">Todos</button><button data-t="carro">Carros</button><button data-t="moto">Motos</button><button data-t="bicicleta">Bicis</button></div>
        <div class="seg" id="fEstado"><button data-s="" class="on">Cualquier estado</button><button data-s="disponible">Libres</button><button data-s="ocupado">Ocupados</button></div>
      </div>
      <div class="table-wrap" id="tabla">${loading()}</div></div>`;
  // Filtros de la tabla (no se pierden cuando la tabla se actualiza sola)
  const filtroEsp = { q: '', tipo: '', estado: '' };

  sede.bind(el, cargar);
  el.querySelector('#qEsp').oninput = (ev) => { filtroEsp.q = ev.target.value; cargarDeMemoria(); };
  el.querySelectorAll('#fTipo button').forEach((b) => b.onclick = () => {
    filtroEsp.tipo = b.dataset.t; el.querySelectorAll('#fTipo button').forEach((x) => x.classList.toggle('on', x === b)); cargarDeMemoria();
  });
  el.querySelectorAll('#fEstado button').forEach((b) => b.onclick = () => {
    filtroEsp.estado = b.dataset.s; el.querySelectorAll('#fEstado button').forEach((x) => x.classList.toggle('on', x === b)); cargarDeMemoria();
  });
  // Al filtrar no se vuelve a pedir al servidor: se repinta con los espacios que ya se tienen
  let enMemoria = false;
  const cargarDeMemoria = () => { enMemoria = true; cargar(); };

  async function cargar() {
    try {
      const soloTabla = enMemoria && espacios.length > 0;
      enMemoria = false;
      if (!soloTabla) espacios = (await api.get('/espacios', { sede_id: sede.id })).espacios;
      const c = (f) => espacios.filter(f).length;
      // Al filtrar solo se repinta la tabla: la capacidad que el administrador esté editando no se pierde
      if (!soloTabla) el.querySelector('#res').innerHTML = Object.entries(TIPOS).map(([k, v]) => {
        const cap = c((e) => e.tipo_vehiculo === k && e.estado !== 'inactivo');
        const ocu = c((e) => e.tipo_vehiculo === k && e.estado === 'ocupado');
        const res = c((e) => e.tipo_vehiculo === k && e.estado === 'reservado');
        return `<div class="kpi" style="border:1px solid var(--border);border-radius:10px">
          <div class="label">${icon[k]} ${v}s</div>
          <div class="row" style="gap:6px;margin-top:8px;flex-wrap:nowrap">
            <button class="btn sm" data-menos="${k}" aria-label="Menos">−</button>
            <input class="input" type="number" min="0" max="2000" data-cap="${k}" data-actual="${cap}" value="${cap}" style="text-align:center;font-size:20px;font-weight:700;padding:6px">
            <button class="btn sm" data-mas="${k}" aria-label="Más">+</button>
          </div>
          <div class="sub" style="margin-top:6px">${ocu} ocupado(s) · ${res} reservado(s) · mínimo ${ocu + res}</div></div>`;
      }).join('') +
        `<div class="kpi" style="border:1px solid var(--border);border-radius:10px;background:var(--surface-2)"><div class="label">Capacidad total</div>
          <div class="value" id="capTotal">${c((e) => e.estado !== 'inactivo')}</div><div class="sub">${c((e) => e.estado === 'inactivo')} inactivo(s)</div></div>`;
      const totalCap = () => { el.querySelector('#capTotal').textContent = [...el.querySelectorAll('[data-cap]')].reduce((s, i) => s + (Number(i.value) || 0), 0); };
      if (!soloTabla) el.querySelectorAll('[data-cap]').forEach((i) => i.oninput = totalCap);
      if (!soloTabla) el.querySelectorAll('[data-mas],[data-menos]').forEach((b) => b.onclick = () => {
        const i = el.querySelector(`[data-cap="${b.dataset.mas || b.dataset.menos}"]`);
        i.value = Math.max(0, (Number(i.value) || 0) + (b.dataset.mas ? 1 : -1));
        totalCap();
      });
      const q = filtroEsp.q.trim().toLowerCase();
      const visibles = espacios.filter((e) => (!filtroEsp.tipo || e.tipo_vehiculo === filtroEsp.tipo)
        && (!filtroEsp.estado || e.estado === filtroEsp.estado)
        && (!q || [e.codigo, e.placa, e.propietario, e.nota].some((x) => String(x || '').toLowerCase().includes(q))));
      el.querySelector('#tabla').innerHTML = !espacios.length ? '<div class="empty">Esta sede aún no tiene espacios. Use "Crear varios" para generarlos rápido.</div>'
        : !visibles.length ? '<div class="empty">Ningún espacio coincide con el filtro.</div>' : `
        <table class="t"><thead><tr><th>Código</th><th>Tipo</th><th>Estado</th><th>Vehículo</th><th>Nota</th><th></th></tr></thead><tbody>
        ${visibles.map((e) => `<tr><td><b>${esc(e.codigo)}</b></td><td><span class="tipo-cel">${icon[e.tipo_vehiculo]}${TIPOS[e.tipo_vehiculo]}</span></td><td>${estadoEspacio(e.estado)}</td>
          <td>${e.placa ? vehiculo(e.tipo_vehiculo, e.placa, e.propietario, { abonado: !!e.abonado_id }) : '<span class="muted nada">Sin vehículo</span>'}</td><td class="small muted">${esc(e.nota || '')}</td>
          <td class="right" style="white-space:nowrap">
            <button class="btn sm ghost" data-edit="${e.id}">${icon.edit}</button>
            ${e.estado === 'inactivo' ? `<button class="btn sm" data-hab="${e.id}">Habilitar</button>` : ''}
            ${e.estado !== 'ocupado' ? `<button class="btn sm ghost" data-del="${e.id}" title="Eliminar">${icon.x}</button>` : ''}
          </td></tr>`).join('')}</tbody></table>`;

      const find = (id) => espacios.find((e) => e.id == id);
      el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => form(find(b.dataset.edit)));
      el.querySelectorAll('[data-hab]').forEach((b) => b.onclick = async () => { try { await api.patch(`/espacios/${b.dataset.hab}/estado`, { estado: 'disponible' }); ok('Espacio habilitado'); cargar(); } catch (e) { fail(e); } });
      el.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        const e = find(b.dataset.del);
        if (!(await confirmar('Eliminar espacio', `¿Eliminar ${esc(e.codigo)}? Si tiene historial, solo se inhabilitará.`, { cls: 'danger', label: 'Eliminar' }))) return;
        try { const r = await api.del(`/espacios/${e.id}`); ok(r.inhabilitado ? 'Tenía historial: se inhabilitó' : 'Espacio eliminado'); cargar(); } catch (err) { fail(err); }
      });
    } catch (e) { el.querySelector('#tabla').innerHTML = `<div class="alert err" style="margin:16px">${esc(e.message)}</div>`; }
  }

  function form(e) {
    modal({
      title: e ? `Editar ${e.codigo}` : `Nuevo espacio · ${sede.nombre}`,
      body: `<div class="form-grid">
        <label class="f"><span>Código</span><input class="input" name="codigo" value="${esc(e?.codigo || '')}" placeholder="C-25" maxlength="20"></label>
        <label class="f"><span>Tipo de vehículo</span><select class="input" name="tipo_vehiculo">${options(TIPOS, e?.tipo_vehiculo)}</select></label>
        <label class="f full"><span>Nota (opcional)</span><input class="input" name="nota" value="${esc(e?.nota || '')}" maxlength="200" placeholder="Ej.: cubierto, cerca a la salida"></label>
      </div>`,
      actions: [{ label: 'Cancelar' }, {
        label: 'Guardar', cls: 'primary',
        onClick: async (c, root) => {
          const d = formData(root);
          if (e) await api.put(`/espacios/${e.id}`, d); else await api.post('/espacios', { ...d, sede_id: sede.id });
          ok('Espacio guardado'); cargar();
        },
      }],
    });
  }

  el.querySelector('#aplicarCap').onclick = async (ev) => {
    const cambios = [...el.querySelectorAll('[data-cap]')].filter((i) => Number(i.value) !== Number(i.dataset.actual));
    if (!cambios.length) return ok('No hay cambios de capacidad');
    ev.target.disabled = true;
    try {
      for (const i of cambios) {
        const r = await api.put('/espacios/capacidad', { sede_id: sede.id, tipo_vehiculo: i.dataset.cap, cantidad: Number(i.value) });
        const partes = [r.creados && `${r.creados} creados`, r.reactivados && `${r.reactivados} reactivados`, r.retirados && `${r.retirados} retirados`].filter(Boolean);
        ok(`${TIPOS[i.dataset.cap]}s: ${r.anterior} → ${r.capacidad} (${partes.join(', ')})`);
      }
    } catch (e) { fail(e); } finally { ev.target.disabled = false; cargar(); }
  };

  el.querySelector('#uno').onclick = () => form(null);
  el.querySelector('#lote').onclick = () => modal({
    title: `Crear varios espacios · ${sede.nombre}`,
    body: `<div class="form-grid">
      <label class="f"><span>Tipo de vehículo</span><select class="input" name="tipo_vehiculo">${options(TIPOS)}</select></label>
      <label class="f"><span>Cantidad</span><input class="input" type="number" name="cantidad" value="10" min="1" max="200"></label>
      <label class="f full"><span>Prefijo del código</span><input class="input" name="prefijo" value="C" maxlength="4">
        <small class="muted">Se crean como C-01, C-02… continuando la numeración existente.</small></label>
    </div>`,
    onOpen: (root) => root.querySelector('[name=tipo_vehiculo]').addEventListener('change', (ev) => { root.querySelector('[name=prefijo]').value = { carro: 'C', moto: 'M', bicicleta: 'B' }[ev.target.value]; }),
    actions: [{ label: 'Cancelar' }, {
      label: 'Crear', cls: 'primary',
      onClick: async (c, root) => { const r = await api.post('/espacios/lote', { ...formData(root), sede_id: sede.id }); ok(`${r.creados} espacios creados`); cargar(); },
    }],
  });

  await cargar();
  // Se actualiza solo con los cambios de la operación, salvo que el administrador esté editando la capacidad
  ctx.alCambiar(() => {
    const editando = [...el.querySelectorAll('[data-cap]')].some((i) => String(i.value) !== String(i.dataset.actual))
      || (document.activeElement?.matches('input, select, textarea') && el.contains(document.activeElement));
    if (!editando) return cargar();
  });
}
