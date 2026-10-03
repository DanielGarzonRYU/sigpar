/**
 * Reportes (OE4): recaudo, horas pico, cierre de caja y comparativo entre sedes.
 * Todos exportables a PDF y Excel.
 */
import { api } from '../api.js';
import { esc, money, n, icon, TIPOS, METODOS, hoyISO, diasAtrasISO, loading, fail, exportExcel, exportPDF, duracion } from '../ui.js';
import { chart } from '../charts.js';

/** "2026-09-27" → "dom 27 sept": se lee mejor en tablas y gráficas. */
const diaCorto = (iso) => new Date(iso + 'T12:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');

export default async function (el, ctx) {
  const esAdmin = ctx.can('superadmin', 'admin');
  const tabs = [
    ...(esAdmin ? [['recaudo', 'Recaudo'], ['horas', 'Horas pico']] : []),
    ['caja', 'Cierre de caja'],
    ...(esAdmin && ctx.sedes.length > 1 ? [['comparativo', 'Comparativo de sedes']] : []),
    ...(esAdmin ? [['indicadores', 'Indicadores']] : []),
  ];
  let tab = tabs[0][0];
  let rango = { desde: diasAtrasISO(6), hasta: hoyISO() };
  let charts = [];

  el.innerHTML = `
    <div class="page-head">
      <div><h1>${tabs.length === 1 ? 'Cierre de caja' : 'Reportes'}</h1><p id="sub"></p></div>
      <div class="row"><button class="btn" id="xls">${icon.excel} Excel</button><button class="btn" id="pdf">${icon.pdf} PDF</button></div>
    </div>
    <div class="row between" style="margin-bottom:16px">
      <div class="seg scroll ${tabs.length === 1 ? 'hidden' : ''}" id="tabs">${tabs.map(([k, v]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${v}</button>`).join('')}</div>
      <div class="row range-row" id="rango"></div>
    </div>
    <div id="body"></div>`;

  const body = el.querySelector('#body');
  let exportar = { xls: null, pdf: null };

  function pintarRango() {
    const box = el.querySelector('#rango');
    if (tab === 'caja') {
      box.innerHTML = `<label class="f row" style="gap:8px"><span style="margin:0">Fecha</span><input class="input" type="date" id="fCaja" value="${rango.caja || hoyISO()}" style="width:auto"></label>`;
      box.querySelector('#fCaja').onchange = (e) => { rango.caja = e.target.value; cargar(); };
      return;
    }
    const presets = [['Hoy', 0], ['7 días', 6], ['30 días', 29], ['90 días', 89]];
    box.innerHTML = `
      <div class="seg">${presets.map(([t, d]) => `<button data-d="${d}" class="${rango.desde === diasAtrasISO(d) && rango.hasta === hoyISO() ? 'on' : ''}">${t}</button>`).join('')}</div>
      <input class="input" type="date" id="d0" value="${rango.desde}" style="width:auto">
      <input class="input" type="date" id="d1" value="${rango.hasta}" style="width:auto">`;
    box.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { rango.desde = diasAtrasISO(+b.dataset.d); rango.hasta = hoyISO(); pintarRango(); cargar(); });
    box.querySelector('#d0').onchange = (e) => { rango.desde = e.target.value; pintarRango(); cargar(); };
    box.querySelector('#d1').onchange = (e) => { rango.hasta = e.target.value; pintarRango(); cargar(); };
  }

  el.querySelectorAll('#tabs button').forEach((b) => b.onclick = () => {
    tab = b.dataset.t;
    el.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    pintarRango(); cargar();
  });

  /** Las secciones plegables empiezan abiertas en pantallas grandes y cerradas en el celular. */
  const abrirEnEscritorio = (root) => root.querySelectorAll('details.plegable').forEach((d) => { d.open = window.innerWidth > 720; });
  const limpiar = () => { charts.forEach((c) => c.destroy()); charts = []; };
  const sub = (t) => { el.querySelector('#sub').textContent = t; };
  const periodo = () => `${rango.desde} a ${rango.hasta}`;

  async function cargar(silencioso = false) {
    limpiar();
    if (!silencioso) body.innerHTML = loading();
    try {
      if (tab === 'recaudo') await recaudo();
      if (tab === 'horas') await horas();
      if (tab === 'caja') await caja();
      if (tab === 'comparativo') await comparativo();
      if (tab === 'indicadores') await indicadores();
    } catch (e) { body.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
  }

  // ------------------------------------------------------------- RECAUDO
  async function recaudo() {
    const r = await api.get('/reportes/recaudo', { ...rango, sede_id: ctx.sedeParam });
    sub(`${ctx.sedeNombre} · ${periodo()}`);
    const t = r.totales;
    const multi = ctx.sede === 'all';
    body.innerHTML = `
      <div class="grid g4">
        <div class="card kpi"><div class="label">Recaudo total</div><div class="value">${money(t.total)}</div></div>
        <div class="card kpi"><div class="label">Parqueo por horas</div><div class="value">${money(t.parqueo)}</div><div class="sub">${n(t.vehiculos)} vehículos</div></div>
        <div class="card kpi"><div class="label">Mensualidades</div><div class="value">${money(t.mensualidades)}</div></div>
        <div class="card kpi"><div class="label">Ticket promedio</div><div class="value">${money(t.vehiculos ? t.parqueo / t.vehiculos : 0)}</div><div class="sub">${t.anulados} anulado(s)</div></div>
      </div>
      <div class="grid g-main" style="margin-top:16px">
        <div class="card"><div class="card-h"><h3>Recaudo por día</h3></div><div class="card-b"><div class="chart-box"><canvas id="c1"></canvas></div></div></div>
        <div class="card"><div class="card-h"><h3>Por método de pago</h3></div><div class="card-b"><div class="chart-box"><canvas id="c2"></canvas></div></div></div>
      </div>
      <div class="grid g2" style="margin-top:16px">
        <details class="card plegable"><summary class="card-h"><h3>Detalle diario</h3><span class="small muted only-m">Ver detalle</span></summary><div class="card-b" style="padding:12px 0 0"><div class="table-wrap">
          <table class="t"><thead><tr><th>Fecha</th>${multi ? '<th>Sede</th>' : ''}<th class="num">Vehículos</th><th class="num">Parqueo</th><th class="num">Mensualidades</th><th class="num">Total</th></tr></thead>
          <tbody>${r.filas.map((f) => `<tr><td style="white-space:nowrap">${diaCorto(f.fecha)}</td>${multi ? `<td>${esc(f.sede)}</td>` : ''}<td class="num">${f.vehiculos}</td><td class="num">${money(f.parqueo)}</td><td class="num">${money(f.mensualidades)}</td><td class="num"><b>${money(f.total)}</b></td></tr>`).join('') || `<tr><td colspan="6" class="empty">Sin datos</td></tr>`}</tbody>
          <tfoot><tr><td>Total</td>${multi ? '<td></td>' : ''}<td class="num">${t.vehiculos}</td><td class="num">${money(t.parqueo)}</td><td class="num">${money(t.mensualidades)}</td><td class="num">${money(t.total)}</td></tr></tfoot></table></div></div></details>
        <div class="card"><div class="card-h"><h3>Por tipo de vehículo</h3></div><div class="card-b" style="padding:12px 0 0"><div class="table-wrap">
          <table class="t"><thead><tr><th>Tipo</th><th class="num">Vehículos</th><th class="num">Estancia promedio</th><th class="num">Recaudo</th></tr></thead>
          <tbody>${r.por_tipo.map((x) => `<tr><td><span class="tipo-cel">${icon[x.tipo] || ''}${TIPOS[x.tipo]}</span></td><td class="num">${x.cantidad}</td><td class="num">${duracion(x.minutos_promedio)}</td><td class="num">${money(x.total)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Sin datos</td></tr>'}</tbody></table></div></div></div>
      </div>`;

    abrirEnEscritorio(body);
    // Serie por día (sumando sedes)
    const porDia = {};
    r.filas.forEach((f) => { porDia[f.fecha] ??= { p: 0, m: 0 }; porDia[f.fecha].p += f.parqueo; porDia[f.fecha].m += f.mensualidades; });
    const dias = Object.keys(porDia).sort();
    charts.push(chart(body.querySelector('#c1'), (p) => ({
      type: 'bar', opts: { moneyAxis: true, stacked: true },
      data: { labels: dias.map(diaCorto), datasets: [
        { label: 'Parqueo', data: dias.map((d) => porDia[d].p), backgroundColor: p.primary, borderRadius: 3 },
        { label: 'Mensualidades', data: dias.map((d) => porDia[d].m), backgroundColor: p.teal, borderRadius: 3 },
      ] },
    })));
    charts.push(chart(body.querySelector('#c2'), (p) => ({
      type: 'doughnut',
      data: { labels: r.por_metodo.map((x) => METODOS[x.metodo] || x.metodo), datasets: [{ data: r.por_metodo.map((x) => +x.total), backgroundColor: p.series, borderWidth: 0 }] },
      options: { plugins: { legend: { position: 'bottom', labels: { color: p.text, usePointStyle: true } }, tooltip: { callbacks: { label: (c) => `${c.label}: ${money(c.parsed)}` } } } },
    })));

    const cols = [
      { h: 'Fecha', v: (f) => f.fecha }, { h: 'Sede', v: (f) => f.sede }, { h: 'Vehículos', v: (f) => f.vehiculos, num: true },
      { h: 'Parqueo', v: (f) => f.parqueo, money: true }, { h: 'Mensualidades', v: (f) => f.mensualidades, money: true }, { h: 'Total', v: (f) => f.total, money: true },
    ];
    exportar = {
      xls: () => exportExcel(`sigpar-recaudo-${rango.desde}_${rango.hasta}`, cols, r.filas, 'Recaudo'),
      pdf: () => exportPDF(`sigpar-recaudo-${rango.desde}_${rango.hasta}`, 'Reporte de recaudo', `${ctx.sedeNombre} · ${periodo()}`, cols, r.filas,
        { pie: ['Total', '', String(t.vehiculos), money(t.parqueo), money(t.mensualidades), money(t.total)] }),
    };
  }

  // ---------------------------------------------------------- HORAS PICO
  async function horas() {
    const r = await api.get('/reportes/horas-pico', { ...rango, sede_id: ctx.sedeParam });
    sub(`${ctx.sedeNombre} · ${periodo()} · Entradas registradas por hora y por día`);
    const max = Math.max(...r.por_hora);
    const pico = r.por_hora.indexOf(max);
    const diaPico = r.por_dia.indexOf(Math.max(...r.por_dia));
    body.innerHTML = `
      <div class="grid g3">
        <div class="card kpi"><div class="label">Hora de mayor demanda</div><div class="value">${max ? `${pico}:00 a ${pico + 1}:00` : 'Sin datos'}</div><div class="sub">${n(max)} entradas en el periodo</div></div>
        <div class="card kpi"><div class="label">Día de mayor demanda</div><div class="value">${r.por_dia[diaPico] ? r.dias_semana[diaPico] : 'Sin datos'}</div><div class="sub">${n(r.por_dia[diaPico])} entradas</div></div>
        <div class="card kpi"><div class="label">Total de entradas</div><div class="value">${n(r.por_hora.reduce((a, b) => a + b, 0))}</div></div>
      </div>
      <div class="grid g2" style="margin-top:16px">
        <div class="card"><div class="card-h"><h3>Entradas por hora del día</h3></div><div class="card-b"><div class="chart-box"><canvas id="c1"></canvas></div></div></div>
        <div class="card"><div class="card-h"><h3>Entradas por día de la semana</h3></div><div class="card-b"><div class="chart-box"><canvas id="c2"></canvas></div></div></div>
      </div>`;
    charts.push(chart(body.querySelector('#c1'), (p) => ({
      type: 'bar', opts: { legend: false },
      data: { labels: r.por_hora.map((_, h) => `${h}h`), datasets: [{ label: 'Entradas', data: r.por_hora, backgroundColor: r.por_hora.map((v) => (v === max && max ? p.orange : p.primary)), borderRadius: 3 }] },
    })));
    charts.push(chart(body.querySelector('#c2'), (p) => ({
      type: 'bar', opts: { legend: false },
      data: { labels: r.dias_semana, datasets: [{ label: 'Entradas', data: r.por_dia, backgroundColor: p.teal, borderRadius: 3 }] },
    })));
    const filas = r.por_hora.map((v, h) => ({ h: `${h}:00 - ${h + 1}:00`, v }));
    const cols = [{ h: 'Franja horaria', v: (f) => f.h }, { h: 'Entradas', v: (f) => f.v, num: true }];
    exportar = {
      xls: () => exportExcel(`sigpar-horas-pico-${rango.desde}_${rango.hasta}`, cols, filas, 'Horas pico'),
      pdf: () => exportPDF(`sigpar-horas-pico-${rango.desde}_${rango.hasta}`, 'Horas de mayor demanda', `${ctx.sedeNombre} · ${periodo()}`, cols, filas),
    };
  }

  // ------------------------------------------------------- CIERRE DE CAJA
  async function caja() {
    const f = rango.caja || hoyISO();
    const r = await api.get('/reportes/caja', { fecha: f, sede_id: ctx.sedeParam });
    sub(`${ctx.sedeNombre} · ${f} · Lo recaudado por cada operador (salidas cobradas y mensualidades)`);
    const metodo = (m) => (m.startsWith('mensualidad_') ? `Mensualidad · ${METODOS[m.slice(12)]}` : METODOS[m] || m);
    body.innerHTML = `
      <div class="grid g3">
        <div class="card kpi"><div class="label">Total del día</div><div class="value">${money(r.total)}</div></div>
        <div class="card kpi"><div class="label">Efectivo esperado en caja</div><div class="value">${money(r.efectivo)}</div><div class="sub">Compare con el dinero físico</div></div>
        <div class="card kpi"><div class="label">Otros medios</div><div class="value">${money(r.total - r.efectivo)}</div><div class="sub">Tarjeta, transferencia, app</div></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="table-wrap">
        <table class="t"><thead><tr><th>Operador</th><th>Sede</th><th>Concepto / método</th><th class="num">Transacciones</th><th class="num">Total</th></tr></thead>
        <tbody>${r.resumen.map((x) => `<tr><td>${esc(x.usuario)}</td><td>${esc(x.sede)}</td><td>${metodo(x.metodo)}</td><td class="num">${x.cantidad}</td><td class="num">${money(x.total)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin recaudos en esta fecha</td></tr>'}</tbody>
        <tfoot><tr><td colspan="4">Total</td><td class="num">${money(r.total)}</td></tr></tfoot></table></div></div>`;
    const cols = [{ h: 'Operador', v: (x) => x.usuario }, { h: 'Sede', v: (x) => x.sede }, { h: 'Concepto', v: (x) => metodo(x.metodo) }, { h: 'Transacciones', v: (x) => x.cantidad, num: true }, { h: 'Total', v: (x) => +x.total, money: true }];
    exportar = {
      xls: () => exportExcel(`sigpar-cierre-caja-${f}`, cols, r.resumen, 'Cierre de caja'),
      pdf: () => exportPDF(`sigpar-cierre-caja-${f}`, 'Cierre de caja', `${ctx.sedeNombre} · ${f} · Efectivo esperado: ${money(r.efectivo)}`, cols, r.resumen, { pie: ['Total', '', '', '', money(r.total)] }),
    };
  }

  // --------------------------------------------------------- COMPARATIVO
  async function comparativo() {
    const r = await api.get('/reportes/comparativo', rango);
    sub(`Todas las sedes · ${periodo()} · Compare el desempeño de cada sede`);
    const s = r.sedes;
    body.innerHTML = `
      <div class="grid g2">
        <div class="card"><div class="card-h"><h3>Recaudo por sede</h3></div><div class="card-b"><div class="chart-box"><canvas id="c1"></canvas></div></div></div>
        <div class="card"><div class="card-h"><h3>Vehículos atendidos y ocupación actual</h3></div><div class="card-b"><div class="chart-box"><canvas id="c2"></canvas></div></div></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="table-wrap">
        <table class="t"><thead><tr><th>Sede</th><th class="num">Capacidad</th><th class="num">Ocupación ahora</th><th class="num">Vehículos</th><th class="num">Estancia prom.</th><th class="num">Ticket prom.</th><th class="num">Abonados</th><th class="num">Anulados</th><th class="num">Parqueo</th><th class="num">Mensualidades</th><th class="num">Total</th></tr></thead>
        <tbody>${s.map((x) => `<tr><td><b>${esc(x.nombre)}</b></td><td class="num">${x.capacidad}</td><td class="num">${x.ocupacion_pct}%</td><td class="num">${n(x.vehiculos)}</td><td class="num">${duracion(x.minutos_promedio)}</td><td class="num">${money(x.ticket_promedio)}</td><td class="num">${x.abonados_vigentes}</td><td class="num">${x.anulados}</td><td class="num">${money(x.parqueo)}</td><td class="num">${money(x.mensualidades)}</td><td class="num"><b>${money(x.total)}</b></td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${s.reduce((a, x) => a + +x.capacidad, 0)}</td><td></td><td class="num">${n(s.reduce((a, x) => a + +x.vehiculos, 0))}</td><td></td><td></td><td class="num">${s.reduce((a, x) => a + +x.abonados_vigentes, 0)}</td><td class="num">${s.reduce((a, x) => a + +x.anulados, 0)}</td><td class="num">${money(s.reduce((a, x) => a + +x.parqueo, 0))}</td><td class="num">${money(s.reduce((a, x) => a + +x.mensualidades, 0))}</td><td class="num">${money(s.reduce((a, x) => a + x.total, 0))}</td></tr></tfoot></table></div></div>`;
    charts.push(chart(body.querySelector('#c1'), (p) => ({
      type: 'bar', opts: { moneyAxis: true, stacked: true },
      data: { labels: s.map((x) => x.nombre), datasets: [
        { label: 'Parqueo', data: s.map((x) => +x.parqueo), backgroundColor: p.primary, borderRadius: 4 },
        { label: 'Mensualidades', data: s.map((x) => +x.mensualidades), backgroundColor: p.teal, borderRadius: 4 },
      ] },
    })));
    charts.push(chart(body.querySelector('#c2'), (p) => ({
      type: 'bar',
      data: { labels: s.map((x) => x.nombre), datasets: [
        { label: 'Vehículos atendidos', data: s.map((x) => +x.vehiculos), backgroundColor: p.primary, borderRadius: 4 },
        { label: 'Ocupación actual (%)', data: s.map((x) => x.ocupacion_pct), backgroundColor: p.orange, borderRadius: 4 },
      ] },
    })));
    const cols = [
      { h: 'Sede', v: (x) => x.nombre }, { h: 'Capacidad', v: (x) => x.capacidad, num: true }, { h: 'Ocupación %', v: (x) => x.ocupacion_pct, num: true },
      { h: 'Vehículos', v: (x) => x.vehiculos, num: true }, { h: 'Estancia prom. (min)', v: (x) => x.minutos_promedio, num: true },
      { h: 'Ticket prom.', v: (x) => x.ticket_promedio, money: true }, { h: 'Parqueo', v: (x) => +x.parqueo, money: true },
      { h: 'Mensualidades', v: (x) => +x.mensualidades, money: true }, { h: 'Total', v: (x) => x.total, money: true },
    ];
    exportar = {
      xls: () => exportExcel(`sigpar-comparativo-${rango.desde}_${rango.hasta}`, cols, s, 'Comparativo'),
      pdf: () => exportPDF(`sigpar-comparativo-${rango.desde}_${rango.hasta}`, 'Comparativo de sedes', periodo(), cols, s, { horizontal: true }),
    };
  }

  // ------------------------------------------ INDICADORES (MARCO LÓGICO)
  async function indicadores() {
    const r = await api.get('/reportes/indicadores', { ...rango, sede_id: ctx.sedeParam });
    sub(`${ctx.sedeNombre} · ${periodo()} · Indicadores SMART del proyecto, medidos con los datos reales del sistema`);
    const pctTxt = (v) => (v === null || v === undefined ? 'Sin datos' : `${String(v).replace('.', ',')} %`);
    const m = r.movimientos;
    const tend = r.errores_pct !== null && r.errores_pct_anterior
      ? Math.round(((r.errores_pct - r.errores_pct_anterior) / r.errores_pct_anterior) * 100) : null;
    const fila = (nivel, nombre, meta, valor, estado, como) => `<tr>
      <td><span class="badge blue">${nivel}</span></td><td><b>${nombre}</b><div class="small muted">${como}</div></td>
      <td>${meta}</td><td class="num"><b>${valor}</b></td><td>${estado}</td></tr>`;
    const ok = (c) => (c ? '<span class="badge green">Cumple</span>' : '<span class="badge orange">Por mejorar</span>');
    const filas = [
      fila('Fin', 'Errores de cobro', 'Bajar 20 % en 12 meses', pctTxt(r.errores_pct),
        r.errores_pct === 0 ? '<span class="badge green">Cumple · sin errores</span>'
          : tend === null ? '<span class="badge gray">Sin datos del periodo anterior</span>' : tend <= -20 ? '<span class="badge green">Bajó ' + (-tend) + ' %</span>' : `<span class="badge ${tend <= 0 ? 'blue' : 'orange'}">${tend <= 0 ? 'Bajó' : 'Subió'} ${Math.abs(tend)} % vs. periodo anterior</span>`,
        `Registros anulados por corrección (${m.anulados} de ${m.total})`),
      fila('R1', 'Movimientos registrados en el sistema', '100 %', m.total ? '100 %' : 'Sin datos', ok(m.total > 0), `${m.total} entradas registradas (${pctTxt(r.app_pct)} desde la app)`),
      fila('R2', 'Cobros calculados automáticamente', '100 %', pctTxt(r.cobros_automaticos_pct), ok(r.cobros_automaticos_pct === 100), `${m.cobrados} cobros; el sistema no permite digitar el valor a mano`),
      fila('R3', 'Abonados con aviso de vencimiento activo', '100 %', pctTxt(r.abonados_aviso_pct), ok(r.abonados_aviso_pct === 100), `${r.abonados.con_aviso} de ${r.abonados.total} abonados vigentes tienen correo o celular`),
      fila('R4', 'Disponibilidad del módulo de reportes', '95 %', 'Ver UptimeRobot', '<span class="badge gray">Externo</span>', 'Lo mide el monitor de UptimeRobot (panel de disponibilidad)'),
    ];
    body.innerHTML = `
      <div class="alert info small" style="margin-bottom:16px">Estos son los indicadores de la Matriz de Marco Lógico de SIGPAR. El del Propósito (tiempo de atención por vehículo) se mide en la prueba piloto con cronómetro, antes y después de usar el sistema.</div>
      <div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Nivel</th><th>Indicador</th><th>Meta</th><th class="num">Resultado</th><th>Estado</th></tr></thead>
      <tbody>${filas.join('')}</tbody></table></div></div>`;
    const plano = [
      ['Fin', 'Errores de cobro (anulaciones)', 'Bajar 20 %', pctTxt(r.errores_pct)],
      ['R1', 'Movimientos registrados', '100 %', m.total ? '100 %' : 'Sin datos'],
      ['R2', 'Cobros automáticos', '100 %', pctTxt(r.cobros_automaticos_pct)],
      ['R3', 'Abonados con aviso activo', '100 %', pctTxt(r.abonados_aviso_pct)],
      ['R4', 'Disponibilidad de reportes', '95 %', 'UptimeRobot'],
    ];
    const cols = ['Nivel', 'Indicador', 'Meta', 'Resultado'].map((h, i) => ({ h, v: (f) => f[i] }));
    exportar = {
      xls: () => exportExcel(`sigpar-indicadores-${rango.desde}_${rango.hasta}`, cols, plano, 'Indicadores'),
      pdf: () => exportPDF(`sigpar-indicadores-${rango.desde}_${rango.hasta}`, 'Indicadores del proyecto (Marco Lógico)', `${ctx.sedeNombre} · ${periodo()}`, cols, plano),
    };
  }

  el.querySelector('#xls').onclick = () => { try { exportar.xls?.(); } catch (e) { fail(e); } };
  el.querySelector('#pdf').onclick = () => { try { exportar.pdf?.(); } catch (e) { fail(e); } };

  pintarRango();
  await cargar();
  // El cierre de caja y los reportes que incluyen hoy se actualizan solos con cada salida o pago
  ctx.alCambiar(() => {
    const incluyeHoy = tab === 'caja' ? (rango.caja || hoyISO()) === hoyISO() : rango.hasta >= hoyISO();
    if (incluyeHoy) return cargar(true);
  });
  return limpiar;
}
