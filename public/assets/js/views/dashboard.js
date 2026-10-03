/**
 * Dashboard en tiempo real (OE4): ocupación, ingresos, actividad reciente y una gráfica a la vez.
 *
 * Antes eran dos gráficas seguidas y se veía saturado: ahora lo primero es lo que se consulta
 * todo el día (indicadores, actividad y ocupación) y las tendencias van en una sola tarjeta con selector.
 */
import { api } from '../api.js';
import { money, n, esc, hora, momento, TIPOS, icon, loadingTablero, vehiculo } from '../ui.js';
import { chart } from '../charts.js';

const GRAFICAS = {
  ingresos: { boton: 'Ingresos 7 días', titulo: 'Ingresos de los últimos 7 días', nota: 'Parqueo + mensualidades' },
  horas: { boton: 'Entradas por hora', titulo: 'Entradas por hora (hoy)', nota: 'Horas de mayor demanda' },
};

export default async function (el, ctx) {
  el.innerHTML = loadingTablero();
  let data;
  try { data = await api.get('/dashboard', { sede_id: ctx.sedeParam }); } catch (e) { el.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; return; }

  const multi = ctx.sede === 'all' && data.por_sede.length > 1;
  let grafica = 'ingresos';
  try { grafica = localStorage.getItem('sigpar_dash_grafica') || 'ingresos'; } catch { /* sin almacenamiento */ }
  if (!GRAFICAS[grafica]) grafica = 'ingresos';

  el.innerHTML = `
    <div class="page-head">
      <div><h1>${esc(ctx.sedeNombre)}</h1><p>Resumen en tiempo real: se actualiza solo cuando hay una entrada, una salida o un pago.</p></div>
      <div class="row">
        <span class="small muted" id="upd"></span>
        <button class="btn primary" id="goOp">${icon.in} Registrar entrada / salida</button>
      </div>
    </div>

    <div class="grid g4" id="kpis"></div>

    <div class="grid g-main" style="margin-top:16px">
      <div class="card">
        <div class="card-h"><h3>Actividad reciente</h3><a href="#/movimientos" class="small">Ver historial</a></div>
        <div class="card-b" style="padding-top:4px"><ul class="alert-list" id="recent"></ul></div>
      </div>
      <div class="card">
        <div class="card-h"><h3>${multi ? 'Ocupación por sede' : 'Ocupación por tipo de vehículo'}</h3></div>
        <div class="card-b sede-bars" id="bars"></div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-h">
        <div><h3 id="gTitulo"></h3><span class="small muted" id="gNota"></span></div>
        <div class="seg" id="gSel">${Object.entries(GRAFICAS).map(([k, g]) => `<button data-g="${k}">${g.boton}</button>`).join('')}</div>
      </div>
      <div class="card-b"><div class="chart-box"><canvas id="cGraf"></canvas></div></div>
    </div>`;

  el.querySelector('#goOp').onclick = () => ctx.go('operacion');

  // ---------------------------------------------------------------- Gráfica (una a la vez)
  const config = {
    ingresos: (p) => ({
      type: 'bar',
      opts: { moneyAxis: true, stacked: true },
      data: {
        labels: data.ingresos_7dias.map((d) => new Date(d.fecha + 'T12:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric' })),
        datasets: [
          { label: 'Parqueo', data: data.ingresos_7dias.map((d) => d.parqueo), backgroundColor: p.primary, borderRadius: 4 },
          { label: 'Mensualidades', data: data.ingresos_7dias.map((d) => d.mensualidades), backgroundColor: p.teal, borderRadius: 4 },
        ],
      },
    }),
    horas: (p) => ({
      type: 'bar',
      opts: { legend: false },
      data: {
        labels: data.entradas_por_hora.map((_, h) => `${h}h`),
        datasets: [{ label: 'Entradas', data: data.entradas_por_hora, backgroundColor: p.primary, borderRadius: 3 }],
      },
    }),
  };
  let graf = null;
  function pintarGrafica() {
    graf?.destroy();
    graf = chart(el.querySelector('#cGraf'), config[grafica]);
    el.querySelector('#gTitulo').textContent = GRAFICAS[grafica].titulo;
    el.querySelector('#gNota').textContent = GRAFICAS[grafica].nota;
    el.querySelectorAll('#gSel button').forEach((b) => b.classList.toggle('on', b.dataset.g === grafica));
  }
  el.querySelectorAll('#gSel button').forEach((b) => b.onclick = () => {
    grafica = b.dataset.g;
    try { localStorage.setItem('sigpar_dash_grafica', grafica); } catch { /* sin almacenamiento */ }
    pintarGrafica();
  });

  // ---------------------------------------------------------------- Indicadores, ocupación y actividad
  function paint() {
    const k = data.kpis;
    const pct = k.capacidad ? Math.round((k.ocupados * 100) / k.capacidad) : 0;
    el.querySelector('#upd').textContent = `Actualizado ${hora(data.actualizado)}`;
    el.querySelector('#kpis').innerHTML = `
      <div class="card kpi"><div class="label"><span class="sw" style="background:var(--ocupado)"></span>Ocupación</div>
        <div class="value">${pct}%</div><div class="sub">${n(k.ocupados)} de ${n(k.capacidad)} espacios · ${n(k.disponibles)} libres</div>
        <div class="bar"><span style="width:${pct}%;background:${pct > 85 ? 'var(--ocupado)' : pct > 60 ? 'var(--reservado)' : 'var(--libre)'}"></span></div></div>
      <div class="card kpi"><div class="label">Ingresos de hoy</div>
        <div class="value">${money(k.ingresos_hoy)}</div><div class="sub">Parqueo ${money(k.ingresos_parqueo_hoy)} · Mensual. ${money(k.ingresos_mensualidades_hoy)}</div></div>
      <div class="card kpi"><div class="label">${icon.in} Entradas de hoy</div>
        <div class="value">${n(k.entradas_hoy)}</div><div class="sub">${n(k.ocupados)} vehículo(s) dentro ahora</div></div>
      <div class="card kpi"><div class="label">${icon.out} Salidas de hoy</div>
        <div class="value">${n(k.salidas_hoy)}</div>
        <div class="sub">${n(k.abonados_vigentes)} abonados vigentes${k.abonados_por_vencer ? ` · <b style="color:var(--reservado)">${k.abonados_por_vencer} por vencer</b>` : ''}</div></div>`;

    const barras = multi
      ? data.por_sede.map((s) => ({ nombre: s.nombre, oc: +s.ocupados, cap: +s.capacidad, extra: `${money(s.ingresos_hoy)} hoy · ${s.entradas_hoy} entradas`, click: s.id }))
      : data.por_tipo.map((t) => ({ nombre: TIPOS[t.tipo_vehiculo], ic: icon[t.tipo_vehiculo], oc: +t.ocupados, cap: +t.capacidad, extra: `${t.capacidad - t.ocupados} libres` }));
    el.querySelector('#bars').innerHTML = barras.length ? barras.map((b) => {
      const pc = b.cap ? Math.round((b.oc * 100) / b.cap) : 0;
      const col = pc > 85 ? 'var(--ocupado)' : pc > 60 ? 'var(--reservado)' : 'var(--libre)';
      return `<div class="item" ${b.click ? `data-sede="${b.click}" style="cursor:pointer" title="Ver solo esta sede"` : ''}>
        <div class="row"><b class="tipo-cel">${b.ic || ''}${esc(b.nombre)}</b><span>${b.oc}/${b.cap} · <b>${pc}%</b></span></div>
        <div class="track"><span style="width:${pc}%;background:${col}"></span></div>
        <div class="small muted" style="margin-top:3px">${b.extra}</div></div>`;
    }).join('') : '<div class="empty">Sin espacios configurados</div>';
    el.querySelectorAll('[data-sede]').forEach((d) => d.onclick = () => ctx.setSede(d.dataset.sede));

    el.querySelector('#recent').innerHTML = data.recientes.length ? data.recientes.map((m) => {
      const salida = m.estado === 'finalizado';
      const que = salida ? `Salida ${momento(m.salida_at)}` : m.estado === 'anulado' ? 'Anulado' : `Entrada ${momento(m.entrada_at)}`;
      return `<li><div class="reciente">${vehiculo(m.tipo_vehiculo, m.placa, m.propietario || m.abonado, { abonado: !!m.abonado_id })}
          <div class="small muted reciente-que">${que}${m.espacio ? ' · ' + esc(m.espacio) : ''}${multi ? ' · ' + esc(m.sede) : ''}${m.origen === 'app' ? ' · desde la app' : ''}</div></div>
        ${salida ? `<b>${money(m.valor)}</b>` : m.estado === 'activo' ? '<span class="badge blue">Dentro</span>' : '<span class="badge gray">Anulado</span>'}</li>`;
    }).join('') : '<li class="muted">Sin movimientos todavía</li>';
  }

  paint();
  pintarGrafica();

  async function actualizar() {
    try {
      data = await api.get('/dashboard', { sede_id: ctx.sedeParam });
      paint(); graf.update(); ctx.live(true);
    } catch { ctx.live(false); }
  }
  // Se actualiza apenas hay un cambio (entrada, salida, pago) y, por si acaso, cada minuto
  ctx.alCambiar(actualizar);
  ctx.every(actualizar, 60000);

  return () => { graf?.destroy(); };
}
