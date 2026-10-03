/**
 * Tarifas por sede y tipo de vehículo, con modo de cobro (minuto / fracción / hora) y simulador.
 */
import { api } from '../api.js';
import { esc, icon, TIPOS, money, ok, fail, loading, fechaHora } from '../ui.js';
import { sedeLocal } from '../sede.js';

const MODOS = {
  minuto: { label: 'Por minuto', precio: 'Valor de cada minuto', ayuda: 'Se cobra cada minuto. Ej.: $50 × 37 min = $1.850' },
  fraccion: { label: 'Por fracción', precio: 'Valor de cada fracción', ayuda: 'Se cobra cada bloque de N minutos iniciado. Ej.: $1.000 cada 15 min' },
  hora: { label: 'Por hora', precio: 'Valor de cada hora', ayuda: 'Se cobra cada hora o fracción de hora iniciada. Ej.: 1 h 10 min = 2 horas' },
};

const unidadMin = (t) => (t.modo_cobro === 'minuto' ? 1 : t.modo_cobro === 'hora' ? 60 : Math.max(1, t.fraccion_minutos));

/** Mismo algoritmo que el backend (Parking::calcular), para previsualizar. */
export function simularCobro(t, minutos, redondeo) {
  const min = Math.max(1, Math.round(minutos));
  if (min <= t.minutos_gracia) return { valor: 0, detalle: `Dentro de los ${t.minutos_gracia} minutos de gracia` };
  const u = unidadMin(t);
  const dias = Math.floor(min / 1440); const resto = min % 1440;
  const unidades = Math.ceil(resto / u);
  let vResto = unidades * t.valor_fraccion; let vDia = Math.ceil(1440 / u) * t.valor_fraccion;
  if (t.tope_dia > 0) { vResto = Math.min(vResto, t.tope_dia); vDia = Math.min(vDia, t.tope_dia); }
  const bruto = dias * vDia + (resto ? vResto : 0);
  const valor = Math.ceil(bruto / redondeo) * redondeo;
  const nombre = (n) => (t.modo_cobro === 'minuto' ? `${n} min` : t.modo_cobro === 'hora' ? (n === 1 ? '1 hora' : `${n} horas`) : `${n === 1 ? '1 fracción' : n + ' fracciones'} de ${u} min`);
  const partes = [];
  if (dias) partes.push(`${dias === 1 ? '1 día' : dias + ' días'} × ${money(vDia)}`);
  if (resto) partes.push(t.tope_dia > 0 && unidades * t.valor_fraccion > t.tope_dia ? `${nombre(unidades)} (tope diario ${money(t.tope_dia)})` : `${nombre(unidades)} × ${money(t.valor_fraccion)}`);
  let detalle = `${partes.join(' + ')} = ${money(bruto)}`;
  if (valor !== bruto) detalle += ` → redondeado ${money(valor)}`;
  return { valor, detalle };
}

export default async function (el, ctx) {
  const sede = sedeLocal(ctx, 'sigpar_tar_sede');
  if (!sede.id) { el.innerHTML = '<div class="alert warn">Primero cree una sede.</div>'; return; }
  let redondeo = 50;
  try { redondeo = Math.max(1, Number((await api.get('/config')).config.redondeo_cobro) || 1); } catch { /* por defecto */ }

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Tarifas</h1><p>El administrador define cómo y cuánto se cobra. El cálculo es automático en la web y en la app.</p></div>
      <div class="row">${sede.html()}<button class="btn primary" id="guardar">Guardar cambios</button></div>
    </div>
    <div class="grid g3" id="form">${loading()}</div>
    <div class="card" style="margin-top:16px">
      <div class="card-h"><h3>Simulador de cobro</h3><span class="small muted">Pruebe la tarifa antes de guardarla · redondeo actual: ${redondeo === 1 ? 'sin redondeo' : money(redondeo)} (se cambia en Configuración)</span></div>
      <div class="card-b row" style="align-items:flex-end">
        <label class="f"><span>Vehículo</span><select class="input" id="sTipo">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label class="f"><span>Horas</span><input class="input" type="number" id="sH" value="0" min="0" style="width:90px"></label>
        <label class="f"><span>Minutos</span><input class="input" type="number" id="sM" value="37" min="0" style="width:90px"></label>
        <div class="cobro grow" style="min-width:260px"><div class="small muted">Valor a cobrar</div><div class="total" id="sVal">$0</div><div class="small muted" id="sDet"></div></div>
      </div>
    </div>`;
  sede.bind(el, cargar);

  let tarifas = [];
  const base = { modo_cobro: 'fraccion', valor_fraccion: 0, fraccion_minutos: 15, minutos_gracia: 5, tope_dia: 0, valor_mensualidad: 0 };

  async function cargar() {
    try {
      tarifas = (await api.get('/tarifas', { sede_id: sede.id })).tarifas;
      el.querySelector('#form').innerHTML = Object.entries(TIPOS).map(([k, v]) => {
        const t = { ...base, ...(tarifas.find((x) => x.tipo_vehiculo === k) || {}) };
        return `<div class="card" data-tipo="${k}">
          <div class="card-h"><h3>${icon[k]} ${v}</h3>${t.updated_at ? `<span class="small muted">act. ${fechaHora(t.updated_at)}</span>` : ''}</div>
          <div class="card-b stack">
            <div><span class="small muted" style="font-weight:600">Modo de cobro</span>
              <div class="seg" data-modo style="margin-top:6px;display:flex">${Object.entries(MODOS).map(([m, d]) => `<button type="button" data-m="${m}" class="${t.modo_cobro === m ? 'on' : ''}" style="flex:1">${d.label}</button>`).join('')}</div>
              <div class="small muted" data-ayuda style="margin-top:6px"></div></div>
            <div class="form-grid">
              <label class="f"><span data-lprecio></span><input class="input" type="number" min="0" step="50" name="valor_fraccion" value="${+t.valor_fraccion}"></label>
              <label class="f" data-wfrac><span>Minutos por fracción</span><input class="input" type="number" min="1" max="1440" name="fraccion_minutos" value="${+t.fraccion_minutos}"></label>
              <label class="f"><span>Minutos de gracia</span><input class="input" type="number" min="0" name="minutos_gracia" value="${+t.minutos_gracia}"></label>
              <label class="f"><span>Tope por día (0 = sin tope)</span><input class="input" type="number" min="0" step="100" name="tope_dia" value="${+t.tope_dia}"></label>
              <label class="f full"><span>Mensualidad (abonados)</span><input class="input" type="number" min="0" step="1000" name="valor_mensualidad" value="${+t.valor_mensualidad}"></label>
            </div>
            <div class="alert info small" data-equiv></div>
          </div></div>`;
      }).join('');

      el.querySelectorAll('[data-tipo]').forEach((card) => {
        card.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => {
          card.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b));
          pintarCard(card); simular();
        });
        card.querySelectorAll('input').forEach((i) => i.addEventListener('input', () => { pintarCard(card); simular(); }));
        pintarCard(card);
      });
      simular();
    } catch (e) { el.querySelector('#form').innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
  }

  const leerCard = (card) => {
    const o = { tipo_vehiculo: card.dataset.tipo, modo_cobro: card.querySelector('[data-m].on')?.dataset.m || 'fraccion' };
    card.querySelectorAll('input').forEach((i) => { o[i.name] = Number(i.value) || 0; });
    return o;
  };
  const leer = () => [...el.querySelectorAll('#form [data-tipo]')].map(leerCard);

  function pintarCard(card) {
    const t = leerCard(card);
    const d = MODOS[t.modo_cobro];
    card.querySelector('[data-ayuda]').textContent = d.ayuda;
    card.querySelector('[data-lprecio]').textContent = t.modo_cobro === 'fraccion' ? `Valor de cada fracción de ${Math.max(1, t.fraccion_minutos)} min` : d.precio;
    card.querySelector('[data-wfrac]').classList.toggle('hidden', t.modo_cobro !== 'fraccion');
    const porHora = (t.valor_fraccion * 60) / unidadMin(t);
    card.querySelector('[data-equiv]').innerHTML = t.valor_fraccion > 0
      ? `Equivale a <b>${money(porHora)} por hora</b>${t.modo_cobro !== 'minuto' ? ` (${money(porHora / 60)} por minuto)` : ''}`
      : 'Sin valor: este vehículo no pagará.';
  }

  function simular() {
    const t = leer().find((x) => x.tipo_vehiculo === el.querySelector('#sTipo').value);
    if (!t) return;
    const min = (+el.querySelector('#sH').value || 0) * 60 + (+el.querySelector('#sM').value || 0);
    const r = simularCobro(t, min, redondeo);
    el.querySelector('#sVal').textContent = money(r.valor);
    el.querySelector('#sDet').textContent = r.detalle;
  }
  ['#sTipo', '#sH', '#sM'].forEach((s) => el.querySelector(s).addEventListener('input', simular));

  el.querySelector('#guardar').onclick = async (e) => {
    e.target.disabled = true;
    try { await api.put(`/tarifas/${sede.id}`, { tarifas: leer() }); ok('Tarifas guardadas'); cargar(); } catch (err) { fail(err); } finally { e.target.disabled = false; }
  };

  await cargar();
}
