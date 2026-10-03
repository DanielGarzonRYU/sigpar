/**
 * Usuarios y roles. Superadmin: todos. Admin: solo operadores de sus sedes.
 */
import { api } from '../api.js';
import { esc, icon, ROLES, ok, fail, loading, modal, confirmar, formData, fechaHora, avatar } from '../ui.js';

export default async function (el, ctx) {
  const soySuper = ctx.can('superadmin');
  let usuarios = [];

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Usuarios</h1><p>${soySuper ? 'Administradores y operadores de todas las sedes.' : 'Operadores de sus sedes.'} Las mismas cuentas sirven para la web y la app.</p></div>
      <button class="btn primary" id="nuevo">${icon.plus} Nuevo usuario</button>
    </div>
    <div class="grid g3" style="margin-bottom:16px">
      <div class="card kpi"><div class="label">Superadministrador</div><div class="sub" style="font-size:12.5px;margin-top:6px">Todas las sedes, crea sedes y administradores, ve la auditoría global.</div></div>
      <div class="card kpi"><div class="label">Administrador</div><div class="sub" style="font-size:12.5px;margin-top:6px">Gestiona sus sedes: espacios, tarifas, operadores, reportes y anulaciones.</div></div>
      <div class="card kpi"><div class="label">Operador</div><div class="sub" style="font-size:12.5px;margin-top:6px">Una sede: entradas, salidas, cobros, abonados y su cierre de caja.</div></div>
    </div>
    <div class="card"><div class="table-wrap" id="tabla">${loading()}</div></div>`;

  async function cargar() {
    try {
      usuarios = (await api.get('/usuarios')).usuarios;
      el.querySelector('#tabla').innerHTML = `
        <table class="t"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Sedes</th><th>Último acceso</th><th>Estado</th><th></th></tr></thead><tbody>
        ${usuarios.map((u) => `<tr>
          <td><div class="usr">${avatar(u)}<div><b>${esc(u.nombre)}</b>${u.id === ctx.user.id ? ' <span class="badge blue">Usted</span>' : ''}</div></div></td>
          <td>${esc(u.email)}</td>
          <td><span class="badge ${u.rol === 'superadmin' ? 'blue' : u.rol === 'admin' ? 'orange' : ''}">${ROLES[u.rol]}</span></td>
          <td class="small">${u.rol === 'superadmin' ? 'Todas' : u.sedes.map((s) => esc(s.nombre)).join(', ') || '<span class="badge red">Sin sede</span>'}</td>
          <td class="small muted">${fechaHora(u.ultimo_acceso)}</td>
          <td>${u.activo == 1 ? '<span class="badge green">Activo</span>' : '<span class="badge gray">Inactivo</span>'}</td>
          <td class="right" style="white-space:nowrap">${puedeEditar(u) ? `<button class="btn sm ghost" data-edit="${u.id}">${icon.edit}</button>
            ${u.id !== ctx.user.id ? `<button class="btn sm" data-tog="${u.id}">${u.activo == 1 ? 'Desactivar' : 'Activar'}</button>
            <button class="btn sm ghost peligro" data-del="${u.id}" title="Eliminar usuario" aria-label="Eliminar ${esc(u.nombre)}">${icon.trash}</button>` : ''}` : ''}</td>
        </tr>`).join('')}</tbody></table>`;
      const find = (id) => usuarios.find((u) => u.id == id);
      el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => form(find(b.dataset.edit)));
      el.querySelectorAll('[data-tog]').forEach((b) => b.onclick = async () => {
        const u = find(b.dataset.tog);
        if (u.activo == 1 && !(await confirmar('Desactivar usuario', `${esc(u.nombre)} no podrá ingresar a la web ni a la app.`, { cls: 'danger', label: 'Desactivar' }))) return;
        try { await api.patch(`/usuarios/${u.id}/estado`, { activo: u.activo != 1 }); ok('Usuario actualizado'); cargar(); } catch (e) { fail(e); }
      });
      el.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        const u = find(b.dataset.del);
        const texto = `Se borra la cuenta de <b>${esc(u.nombre)}</b> (${esc(u.email)}) y ya no podrá entrar a la web ni a la app.
          Sus entradas, salidas y cobros pasados se conservan en el historial. Esto no se puede deshacer.
          <br><br>Si solo quiere impedir que entre por un tiempo, use <b>Desactivar</b>.`;
        if (!(await confirmar('Eliminar usuario', texto, { cls: 'danger', label: 'Eliminar definitivamente' }))) return;
        try { await api.del(`/usuarios/${u.id}`); ok(`Usuario ${u.nombre} eliminado`); cargar(); } catch (e) { fail(e); }
      });
    } catch (e) { el.querySelector('#tabla').innerHTML = `<div class="alert err" style="margin:16px">${esc(e.message)}</div>`; }
  }

  const puedeEditar = (u) => soySuper || u.rol === 'operador';

  function form(u) {
    const roles = soySuper ? ROLES : { operador: ROLES.operador };
    const asignadas = new Set((u?.sedes || []).map((s) => s.id));
    modal({
      title: u ? `Editar ${u.nombre}` : 'Nuevo usuario',
      body: `<div class="form-grid">
        <label class="f"><span>Nombre completo</span><input class="input" name="nombre" value="${esc(u?.nombre || '')}"></label>
        <label class="f"><span>Correo</span><input class="input" type="email" name="email" value="${esc(u?.email || '')}"></label>
        <label class="f"><span>Rol</span><select class="input" name="rol" ${u?.id === ctx.user.id ? 'disabled' : ''}>${Object.entries(roles).map(([k, v]) => `<option value="${k}" ${u?.rol === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="f"><span>${u ? 'Nueva contraseña (opcional)' : 'Contraseña (mín. 8)'}</span><input class="input" type="password" name="password" autocomplete="new-password"></label>
        <div class="full" id="sedesBox">
          <span class="small muted" style="font-weight:600">Sedes asignadas <span id="sedesHint"></span></span>
          <div class="row" style="margin-top:8px">${ctx.sedes.map((s) => `<label class="check" style="border:1px solid var(--border);padding:7px 10px;border-radius:8px">
            <input type="checkbox" value="${s.id}" data-sede ${asignadas.has(s.id) ? 'checked' : ''}> ${esc(s.nombre)}</label>`).join('')}</div>
        </div>
      </div>`,
      onOpen: (root) => {
        const rol = root.querySelector('[name=rol]');
        const upd = () => {
          const r = rol.value;
          root.querySelector('#sedesBox').classList.toggle('hidden', r === 'superadmin');
          root.querySelector('#sedesHint').textContent = r === 'operador' ? '(el operador trabaja en una sola sede)' : '(puede elegir varias)';
          root.querySelectorAll('[data-sede]').forEach((c) => { c.type = r === 'operador' ? 'radio' : 'checkbox'; c.name = r === 'operador' ? 'sede_radio' : ''; });
        };
        rol.addEventListener('change', upd);
        upd();
      },
      actions: [{ label: 'Cancelar' }, {
        label: 'Guardar', cls: 'primary',
        onClick: async (c, root) => {
          const d = formData(root);
          d.rol = root.querySelector('[name=rol]').value;
          d.sedes = [...root.querySelectorAll('[data-sede]:checked')].map((x) => Number(x.value));
          delete d.sede_radio;
          if (u) await api.put(`/usuarios/${u.id}`, d); else await api.post('/usuarios', d);
          ok('Usuario guardado'); cargar();
        },
      }],
    });
  }

  el.querySelector('#nuevo').onclick = () => form(null);
  await cargar();
}
