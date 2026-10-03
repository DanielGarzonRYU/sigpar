/**
 * Gestión de sedes (solo superadministrador).
 */
import { api } from '../api.js';
import { esc, icon, ok, fail, loading, modal, confirmar, formData, fecha } from '../ui.js';

export default async function (el, ctx) {
  el.innerHTML = `
    <div class="page-head">
      <div><h1>Sedes</h1><p>Cada sede tiene sus propios espacios, tarifas, abonados, operadores y reportes.</p></div>
      <button class="btn primary" id="nueva">${icon.plus} Nueva sede</button>
    </div>
    <div class="grid g3" id="lista">${loading()}</div>`;

  async function cargar() {
    try {
      const { sedes } = await api.get('/sedes', { todas: 1 });
      el.querySelector('#lista').innerHTML = sedes.map((s) => {
        const pct = s.capacidad ? Math.round((s.ocupados * 100) / s.capacidad) : 0;
        return `<div class="card kpi" style="${s.activa == 1 ? '' : 'opacity:.6'}">
          <div class="row between"><div class="label">${icon.sedes} ${s.activa == 1 ? '<span class="badge green">Activa</span>' : '<span class="badge gray">Inactiva</span>'}</div>
            <div class="row" style="gap:4px"><button class="btn sm ghost" data-edit="${s.id}">${icon.edit}</button></div></div>
          <div class="value" style="font-size:20px">${esc(s.nombre)}</div>
          <div class="sub">${esc(s.direccion || 'Sin dirección')}${s.telefono ? ' · ' + esc(s.telefono) : ''}</div>
          <div class="bar"><span style="width:${pct}%"></span></div>
          <div class="sub" style="margin-top:6px">${s.ocupados}/${s.capacidad} ocupados (${pct}%) · creada ${fecha(s.created_at)}</div>
          <div class="row" style="margin-top:12px">
            ${s.activa == 1 ? `<button class="btn sm" data-ver="${s.id}">Ver dashboard</button>` : ''}
            <button class="btn sm ${s.activa == 1 ? '' : 'primary'}" data-tog="${s.id}" data-act="${s.activa}">${s.activa == 1 ? 'Desactivar' : 'Activar'}</button>
          </div></div>`;
      }).join('') || '<div class="empty">No hay sedes. Cree la primera.</div>';

      const find = (id) => sedes.find((s) => s.id == id);
      el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => form(find(b.dataset.edit)));
      el.querySelectorAll('[data-ver]').forEach((b) => b.onclick = () => { ctx.setSede(b.dataset.ver); ctx.go('dashboard'); });
      el.querySelectorAll('[data-tog]').forEach((b) => b.onclick = async () => {
        const activar = b.dataset.act != 1;
        if (!activar && !(await confirmar('Desactivar sede', 'Los operadores de esta sede no podrán registrar movimientos. Los datos históricos se conservan.', { cls: 'danger', label: 'Desactivar' }))) return;
        try { await api.patch(`/sedes/${b.dataset.tog}/estado`, { activa: activar }); ok('Sede actualizada'); setTimeout(() => location.reload(), 500); } catch (e) { fail(e); }
      });
    } catch (e) { el.querySelector('#lista').innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
  }

  function form(s) {
    modal({
      title: s ? `Editar ${s.nombre}` : 'Nueva sede',
      body: `<div class="form-grid">
        <label class="f full"><span>Nombre</span><input class="input" name="nombre" value="${esc(s?.nombre || '')}" placeholder="Sede Chapinero"></label>
        <label class="f"><span>Dirección</span><input class="input" name="direccion" value="${esc(s?.direccion || '')}"></label>
        <label class="f"><span>Teléfono</span><input class="input" name="telefono" value="${esc(s?.telefono || '')}"></label>
        ${s ? '' : `
        <div class="full alert info small">Se crean las tarifas copiando las de la primera sede (podrá ajustarlas) y los espacios indicados.</div>
        <label class="f"><span>Espacios para carros</span><input class="input" type="number" name="espacios_carro" value="20" min="0"></label>
        <label class="f"><span>Espacios para motos</span><input class="input" type="number" name="espacios_moto" value="10" min="0"></label>
        <label class="f"><span>Espacios para bicicletas</span><input class="input" type="number" name="espacios_bicicleta" value="0" min="0"></label>`}
      </div>`,
      actions: [{ label: 'Cancelar' }, {
        label: 'Guardar', cls: 'primary',
        onClick: async (c, root) => {
          const d = formData(root);
          if (s) await api.put(`/sedes/${s.id}`, d); else await api.post('/sedes', d);
          ok('Sede guardada');
          setTimeout(() => location.reload(), 500); // actualiza el selector de sedes
        },
      }],
    });
  }

  el.querySelector('#nueva').onclick = () => form(null);
  await cargar();
}
