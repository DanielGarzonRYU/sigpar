/**
 * Configuración general (solo superadministrador) y estado del servidor.
 */
import { api } from '../api.js';
import { esc, ok, fail, loading, formData } from '../ui.js';

export default async function (el) {
  el.innerHTML = loading();
  let cfg, health;
  try {
    [cfg, health] = await Promise.all([api.get('/config'), api.get('/health')]);
  } catch (e) { el.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; return; }
  const c = cfg.config;

  el.innerHTML = `
    <div class="page-head"><div><h1>Configuración</h1><p>Datos de la empresa y parámetros generales del sistema.</p></div></div>
    <div class="grid g-main">
      <div class="card"><div class="card-h"><h3>Parámetros</h3></div>
        <form class="card-b" id="f">
          <div class="form-grid">
            <label class="f"><span>Nombre de la empresa (aparece en recibos)</span><input class="input" name="empresa_nombre" value="${esc(c.empresa_nombre || '')}"></label>
            <label class="f"><span>NIT</span><input class="input" name="empresa_nit" value="${esc(c.empresa_nit || '')}"></label>
            <label class="f"><span>Días de anticipación para alertar vencimientos</span><input class="input" type="number" min="1" max="30" name="dias_alerta_abonados" value="${esc(c.dias_alerta_abonados || '5')}"></label>
            <label class="f"><span>Redondeo del cobro (COP)</span><select class="input" name="redondeo_cobro">
              ${['1', '50', '100', '500', '1000'].map((v) => `<option value="${v}" ${c.redondeo_cobro === v ? 'selected' : ''}>${v === '1' ? 'Sin redondeo' : '$' + v}</option>`).join('')}</select></label>
            <label class="f full"><span>Avisos automáticos de vencimiento por correo</span>
              <select class="input" name="avisos_automaticos">${[['1', 'Activados: se envían solos cada mañana'], ['0', 'Desactivados: solo con el botón en Abonados']].map(([v, t]) => `<option value="${v}" ${(c.avisos_automaticos ?? '1') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
            <label class="f full"><span>Política de tratamiento de datos (Ley 1581 de 2012), se muestra al pedir la autorización</span><textarea class="input" rows="4" name="politica_datos">${esc(c.politica_datos || '')}</textarea></label>
          </div>
          <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn primary" type="submit">Guardar</button></div>
        </form></div>
      <div class="card"><div class="card-h"><h3>Estado del sistema</h3></div>
        <div class="card-b"><dl class="kv">
          <dt>Servidor</dt><dd><span class="badge green">En línea</span></dd>
          <dt>Base de datos</dt><dd>${health.db_ms < 300 ? '<span class="badge green">Conectada</span>' : '<span class="badge orange">Conectada (lenta)</span>'}</dd>
          <dt>Correos a abonados</dt><dd>${health.correo ? '<span class="badge green">Configurados</span>' : '<span class="badge gray">No configurados</span>'}</dd>
          <dt>Hora del servidor</dt><dd>${new Date(health.hora).toLocaleString('es-CO')}</dd>
        </dl>
        ${health.demo ? '<div class="alert warn small" style="margin-top:14px">Modo demostración activo: el sistema tiene datos de ejemplo. Antes de usarlo con clientes reales, desactívelo (variable DEMO_DATA=false) y use una base de datos nueva.</div>' : ''}
        ${!health.correo ? '<p class="small muted" style="margin-top:14px">Para enviar avisos por correo configure una cuenta gratuita de Brevo (ver guía de despliegue).</p>' : ''}
        <p class="small muted" style="margin-top:14px">La web y la app usan la misma base de datos: cualquier cambio en una se ve en la otra en segundos.</p></div></div>
    </div>`;

  el.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault();
    try { await api.put('/config', formData(e.target)); ok('Configuración guardada'); } catch (err) { fail(err); }
  };
}
