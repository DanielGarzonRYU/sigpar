/**
 * Auditoría: quién hizo qué, cuándo y en qué sede, escrito en lenguaje claro.
 * Los datos técnicos (IP, detalle crudo) solo van en la exportación a Excel.
 */
import { api } from '../api.js';
import { esc, icon, ROLES, TIPOS, METODOS, money, fecha, fechaHora, diasAtrasISO, hoyISO, loading, options, exportExcel, fail, formData, toast } from '../ui.js';

const MODO = { minuto: 'por minuto', fraccion: 'por fracción', hora: 'por hora' };
const tipoPl = (t) => (TIPOS[t] ? TIPOS[t].toLowerCase() + 's' : t);
const pl = (p) => (p ? `<span class="plate-tag">${esc(p)}</span>` : '');

/** Convierte un registro de auditoría en una frase entendible. Devuelve [frase HTML, tono]. */
export function describir(a, sedes = []) {
  let d = {};
  try { d = a.detalle ? JSON.parse(a.detalle) : {}; } catch { d = { texto: a.detalle }; }
  if (typeof d !== 'object' || d === null) d = { texto: String(d) };
  const k = `${a.accion}:${a.entidad}`;
  const nombreSedes = (ids) => (ids || []).map((id) => sedes.find((s) => s.id == id)?.nombre || `sede ${id}`).join(', ');

  switch (k) {
    case 'entrada:movimiento': return [`Registró la entrada de ${pl(d.placa)} en el espacio <b>${esc(d.espacio || '')}</b>`, 'blue'];
    case 'salida:movimiento': return [`Registró la salida de ${pl(d.placa)} y cobró <b>${money(d.valor)}</b> (${METODOS[d.metodo] || esc(d.metodo || '')})`, 'green'];
    case 'anular:movimiento': return [`<b>Anuló</b> el registro de ${pl(d.placa)}${d.valor ? ` (valor ${money(d.valor)})` : ''}. Motivo: “${esc(d.motivo || '')}”`, 'red'];
    case 'crear:abonado': return [`Inscribió al abonado ${pl(d.placa)} hasta el ${fecha(d.hasta)} por <b>${money(d.valor)}</b>`, 'green'];
    case 'renovar:abonado': return [`Renovó la mensualidad de ${pl(d.placa)} hasta el ${fecha(d.hasta)} por <b>${money(d.valor)}</b>`, 'green'];
    case 'editar:abonado': return [`Editó los datos del abonado ${pl(d.placa)} ${d.nombre ? '(' + esc(d.nombre) + ')' : ''}`, ''];
    case 'activar:abonado': return ['Reactivó un abonado', ''];
    case 'desactivar:abonado': return ['Desactivó un abonado', 'orange'];
    case 'notificar:abonado': return [`Envió avisos de vencimiento por correo a <b>${d.enviados ?? 0}</b> abonado(s)${d.automatico ? ' (envío automático)' : ''}`, ''];
    case 'actualizar:tarifas': {
      const lista = Array.isArray(d) ? d : Object.values(d);
      const txt = lista.filter((t) => t && t.tipo_vehiculo).map((t) =>
        `${TIPOS[t.tipo_vehiculo]}: ${money(t.valor_fraccion ?? t.valor_hora)} ${MODO[t.modo_cobro] || 'por hora'}${t.modo_cobro === 'fraccion' ? ` de ${t.fraccion_minutos} min` : ''}`).join(' · ');
      return [`Cambió las tarifas → ${esc(txt)}`, 'orange'];
    }
    case 'ajustar_capacidad:espacio': return [`Cambió la capacidad de ${tipoPl(d.tipo)} de <b>${d.anterior}</b> a <b>${d.capacidad}</b>`, 'orange'];
    case 'guardar_plano:sede': return [`Guardó el plano de la sede (${d.ancho} x ${d.alto} cuadros, ${d.espacios_ubicados ?? 0} espacios ubicados${d.espacios_nuevos?.length ? `, espacios nuevos: <b>${esc(d.espacios_nuevos.join(', '))}</b>` : ''})`, ''];
    case 'borrar_plano:sede': return ['Borró el plano de la sede: los espacios quedaron sin ubicar', 'orange'];
    case 'eliminar:usuario': return [`Eliminó al usuario <b>${esc(d.nombre || '')}</b> (${esc(d.email || '')}); sus registros pasados se conservan`, 'red'];
    case 'editar_perfil:usuario': return [`Actualizó su perfil${d.foto && d.foto !== 'sin cambio' ? ` (foto ${esc(d.foto)})` : ''}`, ''];
    case 'interpretar_plano:sede': return [`Pidió a la IA un plano ${d.imagen ? 'a partir de una imagen' : 'a partir de una descripción'} (${d.espacios ?? 0} espacios propuestos)`, ''];
    case 'crear:espacio': return [`Creó el espacio <b>${esc(d.codigo || '')}</b>`, ''];
    case 'crear_lote:espacio': return [`Creó ${d.cantidad} espacios para ${tipoPl(d.tipo)}`, ''];
    case 'editar:espacio': return [`Editó el espacio <b>${esc(d.codigo || '')}</b>`, ''];
    case 'eliminar:espacio': return [`Eliminó el espacio <b>${esc(d.codigo || '')}</b>`, 'orange'];
    case 'estado_reservado:espacio': return [`Reservó el espacio <b>${esc(d.codigo || '')}</b>${d.nota ? ` (“${esc(d.nota)}”)` : ''}`, ''];
    case 'estado_disponible:espacio': return [`Liberó el espacio <b>${esc(d.codigo || '')}</b>`, ''];
    case 'estado_inactivo:espacio': return [`Inhabilitó el espacio <b>${esc(d.codigo || '')}</b>`, 'orange'];
    case 'crear:sede': return [`Creó la sede <b>${esc(d.nombre || '')}</b>`, ''];
    case 'editar:sede': return [`Editó los datos de la sede <b>${esc(d.nombre || '')}</b>`, ''];
    case 'activar:sede': return ['Activó una sede', ''];
    case 'desactivar:sede': return ['Desactivó una sede', 'orange'];
    case 'crear:usuario': return [`Creó el usuario <b>${esc(d.email || '')}</b> como ${ROLES[d.rol] || d.rol}`, ''];
    case 'editar:usuario': return [`Editó un usuario (${ROLES[d.rol] || d.rol}${d.sedes?.length ? ' · ' + esc(nombreSedes(d.sedes)) : ''})${d.cambio_password ? ' y le cambió la contraseña' : ''}`, ''];
    case 'activar:usuario': return ['Reactivó el acceso de un usuario', ''];
    case 'desactivar:usuario': return ['<b>Quitó el acceso</b> a un usuario', 'orange'];
    case 'login:usuario': return [`Inició sesión desde la ${d.origen === 'app' ? 'app' : 'web'}`, ''];
    case 'login_fallido:usuario': return [`<b>Intento de ingreso fallido</b> con el correo ${esc(d.email || '')}`, 'red'];
    case 'cambiar_password:usuario': return ['Cambió su contraseña', ''];
    case 'actualizar:configuracion': return ['Cambió la configuración general del sistema', 'orange'];
    case 'carga_demo:sistema': return ['Se cargaron los datos de demostración', ''];
    default: return [`${esc(a.accion)} · ${esc(a.entidad)}`, ''];
  }
}

export default async function (el, ctx) {
  const f = { desde: diasAtrasISO(2), hasta: hoyISO(), categoria: '', page: 1, limit: 50 };

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Auditoría</h1><p>${esc(ctx.sedeNombre)}. Todo lo que hace cada usuario en la web y en la app queda registrado aquí y no se puede borrar.</p></div>
      <div class="row"><button class="btn" id="xls">${icon.excel} Exportar a Excel</button></div>
    </div>
    <div class="grid g4" id="resumen" style="margin-bottom:16px"></div>
    <div class="card">
      <form class="card-b row" id="filtros" style="align-items:flex-end">
        <label class="f"><span>Desde</span><input class="input" type="date" name="desde" value="${f.desde}"></label>
        <label class="f"><span>Hasta</span><input class="input" type="date" name="hasta" value="${f.hasta}"></label>
        <label class="f"><span>Mostrar</span><select class="input" name="categoria"><option value="">Todo</option>${options({
          sensibles: 'Solo acciones sensibles', operacion: 'Entradas, salidas y anulaciones', abonados: 'Abonados',
          configuracion: 'Tarifas, espacios y sedes', accesos: 'Usuarios e ingresos al sistema',
        })}</select></label>
        <button class="btn primary" type="submit">${icon.search} Filtrar</button>
      </form>
      <div class="table-wrap" id="tabla">${loading()}</div>
      <div class="pager" id="pager"></div>
    </div>`;

  const q = (extra = {}) => ({ ...f, sede_id: ctx.sedeParam, ...extra });

  function pintarResumen(r) {
    const tarjeta = (label, valor, color, cat, ayuda) => `
      <button class="card kpi" data-cat="${cat}" style="text-align:left;cursor:pointer;font:inherit;color:inherit">
        <div class="label"><span class="sw" style="background:${color}"></span>${label}</div>
        <div class="value">${valor}</div><div class="sub">${ayuda}</div></button>`;
    el.querySelector('#resumen').innerHTML =
      tarjeta('Entradas y salidas', r.entradas + r.salidas, 'var(--primary)', 'operacion', `${r.entradas} entradas · ${r.salidas} salidas`) +
      tarjeta('Anulaciones', r.anulaciones, r.anulaciones ? 'var(--ocupado)' : 'var(--libre)', 'operacion', r.anulaciones ? 'Revise el motivo de cada una' : 'Ninguna en el periodo') +
      tarjeta('Ingresos fallidos', r.ingresos_fallidos, r.ingresos_fallidos ? 'var(--ocupado)' : 'var(--libre)', 'accesos', 'Contraseñas incorrectas') +
      tarjeta('Cambios de configuración', r.cambios_config, 'var(--reservado)', 'configuracion', 'Tarifas, espacios y sedes');
    el.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => {
      el.querySelector('[name=categoria]').value = b.dataset.cat;
      Object.assign(f, { categoria: b.dataset.cat, page: 1 });
      cargar();
    });
  }

  async function cargar() {
    try {
      const r = await api.get('/auditoria', q());
      pintarResumen(r.resumen);
      el.querySelector('#tabla').innerHTML = r.registros.length ? `
        <table class="t"><thead><tr><th>Cuándo</th><th>Quién</th><th>Qué hizo</th><th>Sede</th></tr></thead><tbody>
        ${r.registros.map((a) => {
          const [frase, tono] = describir(a, ctx.sedes);
          return `<tr>
            <td class="small" style="white-space:nowrap" title="Registro #${a.id}">${fechaHora(a.created_at)}</td>
            <td><b>${esc(a.usuario || 'Sistema')}</b>${ROLES[a.rol] && !String(a.usuario || '').includes(ROLES[a.rol].slice(0, 5)) ? `<div class="small muted">${ROLES[a.rol]}</div>` : ''}</td>
            <td class="col-texto">${tono ? `<span class="sw" style="background:var(--${{ red: 'ocupado', green: 'libre', blue: 'primary', orange: 'reservado' }[tono]});margin-right:6px"></span>` : ''}${frase}</td>
            <td class="small">${esc(a.sede || 'General')}</td></tr>`;
        }).join('')}</tbody></table>` : '<div class="empty">No hay registros con ese filtro.</div>';
      const pages = Math.max(1, Math.ceil(r.total / r.limit));
      el.querySelector('#pager').innerHTML = `<span class="small muted">${r.total} registro(s) · página ${r.page} de ${pages}</span>
        <div class="row"><button class="btn sm" id="prev" ${r.page <= 1 ? 'disabled' : ''}>Anterior</button><button class="btn sm" id="next" ${r.page >= pages ? 'disabled' : ''}>Siguiente</button></div>`;
      el.querySelector('#prev').onclick = () => { f.page--; cargar(); };
      el.querySelector('#next').onclick = () => { f.page++; cargar(); };
    } catch (e) { el.querySelector('#tabla').innerHTML = `<div class="alert err" style="margin:16px">${esc(e.message)}</div>`; }
  }

  el.querySelector('#filtros').onsubmit = (e) => { e.preventDefault(); Object.assign(f, formData(e.target), { page: 1 }); cargar(); };
  el.querySelector('#xls').onclick = async () => {
    try {
      const r = await api.get('/auditoria', q({ page: 1, limit: 5000 }));
      if (r.total > r.registros.length) toast(`Se exportan los ${r.registros.length} registros más recientes de ${r.total}. Acote las fechas para exportar el resto.`);
      const texto = (a) => describir(a, ctx.sedes)[0].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      exportExcel(`sigpar-auditoria-${f.desde}_${f.hasta}`, [
        { h: 'Fecha', v: (a) => a.created_at }, { h: 'Usuario', v: (a) => a.usuario || 'Sistema' }, { h: 'Rol', v: (a) => ROLES[a.rol] || '' },
        { h: 'Qué hizo', v: texto }, { h: 'Sede', v: (a) => a.sede || 'General' },
        { h: 'Acción (técnico)', v: (a) => `${a.accion}/${a.entidad}${a.entidad_id ? '#' + a.entidad_id : ''}` }, { h: 'IP', v: (a) => a.ip || '' },
      ], r.registros, 'Auditoría');
    } catch (e) { fail(e); }
  };

  await cargar();
  ctx.alCambiar(cargar);
}
