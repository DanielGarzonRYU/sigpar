/**
 * Operación diaria: registro de entrada, salida con cobro automático y mapa de espacios en tiempo real.
 * (Es la misma operación que hará el operador desde la app Android.)
 */
import { api } from '../api.js';
import {
  esc, money, placa, icon, TIPOS, METODOS, ok, fail, toast, modal, confirmar, hora, duracion,
  minutosDesde, normalizarPlaca, loading, formData, fecha, vehiculo, momento,
} from '../ui.js';
import { mostrarRecibo } from '../recibo.js';
import { linkPolitica, bindPolitica } from '../extras.js';
import { svgPlano, planoDeSede } from '../plano.js';

export default async function (el, ctx) {
  // Operar requiere una sede concreta
  if (!ctx.sedeId) {
    el.innerHTML = `
      <div class="page-head"><div><h1>Entradas y salidas</h1><p>Seleccione la sede en la que va a operar.</p></div></div>
      <div class="grid g3">${ctx.sedes.map((s) => `
        <button class="card kpi" data-s="${s.id}" style="text-align:left;cursor:pointer;font:inherit;color:inherit">
          <div class="label">${icon.sedes} Sede</div><div class="value" style="font-size:20px">${esc(s.nombre)}</div>
          <div class="sub">Operar en esta sede →</div></button>`).join('')}</div>`;
    el.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => ctx.setSede(b.dataset.s));
    return;
  }

  const sede = ctx.sedeId;
  const esAdmin = ctx.can('superadmin', 'admin');
  let espacios = [];
  let activos = [];
  let tipo = 'carro';
  let espacioSel = null;     // espacio elegido en el mapa para la entrada
  let filtroTipo = '';
  let salidaActual = null;   // { movimiento, cotizacion }
  let tab = 'entrada';
  let desfase = 0; // diferencia entre el reloj del servidor y el del dispositivo (ms)
  let plano = null;          // plano dibujado de la sede (si el administrador lo hizo)
  let vista = 'plano';       // 'plano', 'lista' (espacios) o 'vehiculos' (vehículos dentro)
  try { vista = localStorage.getItem('sigpar_vista_mapa') || 'plano'; } catch { /* sin almacenamiento */ }
  let estadoPrevio = null;   // para resaltar los espacios que acaban de cambiar
  let en3d = false;          // plano inclinado en perspectiva (se recuerda en este navegador)
  try { en3d = localStorage.getItem('sigpar_plano_3d') === '1'; } catch { /* sin almacenamiento */ }

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Entradas y salidas</h1><p>${esc(ctx.sedeNombre)}. Escriba la placa o toque un espacio del mapa.</p></div>
      <div class="legend">
        <span><i class="sw" style="background:var(--libre)"></i>Disponible</span>
        <span><i class="sw" style="background:var(--ocupado)"></i>Ocupado</span>
        <span><i class="sw" style="background:var(--reservado)"></i>Reservado</span>
        <span><i class="sw" style="background:var(--inactivo)"></i>Inactivo</span>
      </div>
    </div>
    <div class="op-grid">
      <div class="card" id="panel">
        <div class="tabs">
          <button data-tab="entrada" class="on">${icon.in} Entrada</button>
          <button data-tab="salida">${icon.out} Salida</button>
        </div>
        <div class="card-b" id="panelBody"></div>
      </div>
      <div class="stack" style="min-width:0">
        <!-- Un solo recuadro para ver el parqueadero: el plano, los espacios o la lista de vehículos dentro.
             (Antes "Vehículos dentro" era otra tarjeta que repetía lo mismo que el mapa.) -->
        <div class="card" id="mapaCard">
          <div class="card-h">
            <h3 id="mapTitle">Parqueadero</h3>
            <div class="seg" id="tipoFiltro">
              <button data-t="" class="on">Todos</button>
              <button data-t="carro">Carros</button><button data-t="moto">Motos</button><button data-t="bicicleta">Bicis</button>
            </div>
          </div>
          <div class="op-vistas">
            <div class="seg" id="vistaMapa">
              <button data-v="plano" class="hidden">${icon.plano} Plano</button>
              <button data-v="lista">${icon.espacios} Espacios</button>
              <button data-v="vehiculos">${icon.carro} Vehículos dentro <b class="op-n" id="nAct">0</b></button>
            </div>
            <input class="input hidden" id="buscaAct" type="search" placeholder="Buscar placa o nombre" autocomplete="off">
            <button class="btn sm hidden" id="ver3d" aria-pressed="false">${icon.cubo} Ver en 3D</button>
          </div>
          <div class="card-b" id="mapa">${loading()}</div>
        </div>
      </div>
    </div>`;

  const panel = el.querySelector('#panelBody');

  // ------------------------------------------------------------- Pestañas
  function setTab(t) {
    tab = t;
    el.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    t === 'entrada' ? renderEntrada() : renderSalida();
  }
  el.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => setTab(b.dataset.tab));

  // -------------------------------------------------------------- ENTRADA
  function renderEntrada() {
    panel.innerHTML = `
      <form id="fEntrada" class="stack" autocomplete="off">
        <label class="f"><span>Placa del vehículo</span>
          <input class="input plate" name="placa" maxlength="8" placeholder="ABC123" required></label>
        <div id="placaInfo"></div>
        <div>
          <span class="small muted" style="font-weight:600">Tipo de vehículo</span>
          <div class="type-pick" style="margin-top:6px">
            ${Object.entries(TIPOS).map(([k, v]) => `<button type="button" data-tipo="${k}" class="${k === tipo ? 'on' : ''}">${icon[k]}${v}</button>`).join('')}
          </div>
        </div>
        <div id="espInfo"></div>
        <div class="form-grid">
          <label class="f"><span>Propietario (opcional)</span><input class="input" name="propietario" maxlength="120"></label>
          <label class="f"><span>Teléfono (opcional)</span><input class="input" name="telefono" maxlength="30" inputmode="tel"></label>
        </div>
        <label class="check"><input type="checkbox" name="autoriza_datos">
          <span>El cliente autoriza guardar su nombre y teléfono (Ley 1581, ${linkPolitica}). Sin autorización no se guardan.</span></label>
        <button class="btn success lg block" type="submit">${icon.in} Registrar entrada</button>
      </form>`;

    const f = panel.querySelector('#fEntrada');
    bindPolitica(panel);
    const infoPlaca = panel.querySelector('#placaInfo');
    paintEspacioSel();

    panel.querySelectorAll('[data-tipo]').forEach((b) => b.onclick = () => {
      tipo = b.dataset.tipo;
      if (espacioSel && espacioSel.tipo_vehiculo !== tipo) espacioSel = null;
      panel.querySelectorAll('[data-tipo]').forEach((x) => x.classList.toggle('on', x === b));
      paintEspacioSel();
    });

    let t;
    f.placa.addEventListener('input', () => {
      const p = normalizarPlaca(f.placa.value);
      // Formato colombiano de moto: ABC12D → se sugiere "moto"
      if (/^[A-Z]{3}\d{2}[A-Z]$/.test(p) && tipo === 'carro') panel.querySelector('[data-tipo="moto"]').click();
      if (/^[A-Z]{3}\d{3}$/.test(p) && tipo === 'moto') panel.querySelector('[data-tipo="carro"]').click();
      clearTimeout(t);
      infoPlaca.innerHTML = '';
      if (p.length < 5) return;
      t = setTimeout(async () => {
        const dentro = activos.find((m) => m.placa === p);
        if (dentro) { infoPlaca.innerHTML = `<div class="alert warn">Este vehículo ya está dentro (espacio ${esc(dentro.espacio)}). <a href="#" id="irSalida">Registrar su salida</a></div>`; infoPlaca.querySelector('#irSalida').onclick = (e) => { e.preventDefault(); abrirSalida(dentro.id); }; return; }
        try {
          const r = await api.get('/abonados', { sede_id: sede, q: p });
          const a = r.abonados.find((x) => x.placa === p);
          if (!a) return;
          if (normalizarPlaca(f.placa.value) !== p) return; // el operador ya cambió la placa
          const vig = ['vigente', 'por_vencer'].includes(a.estado);
          const motivo = { vencido: `Su mensualidad venció el ${fecha(a.fecha_fin)}: se cobrará por tiempo. Ofrezca renovarla.`,
            programado: `Su mensualidad empieza el ${fecha(a.fecha_inicio)}: hoy se cobra por tiempo.`,
            inactivo: 'Abonado desactivado: se cobrará por tiempo.' }[a.estado] || '';
          infoPlaca.innerHTML = `<div class="alert ${vig ? 'info' : 'warn'}"><div><b>Abonado: ${esc(a.nombre)}</b><br>
            ${vig ? `Mensualidad vigente hasta el ${fecha(a.fecha_fin)}: no paga al salir.` : motivo}</div></div>`;
          if (vig) { f.propietario.value = a.nombre; if (a.telefono) f.telefono.value = a.telefono; f.autoriza_datos.checked = true; }
          if (a.tipo_vehiculo !== tipo) panel.querySelector(`[data-tipo="${a.tipo_vehiculo}"]`).click();
        } catch { /* informativo */ }
      }, 350);
    });

    f.onsubmit = async (e) => {
      e.preventDefault();
      const d = formData(f);
      const p = normalizarPlaca(d.placa);
      if (p.length < 3) return fail('Escriba una placa válida');
      const btn = f.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const r = await api.post('/movimientos/entrada', {
          sede_id: sede, placa: p, tipo_vehiculo: tipo, espacio_id: espacioSel?.id,
          propietario: d.propietario, telefono: d.telefono, autoriza_datos: d.autoriza_datos, origen: 'web',
        });
        ok(`Entrada registrada: ${p} → espacio ${r.espacio}${r.abonado ? ' (abonado)' : ''}`);
        if (!r.formato_colombiano && tipo !== 'bicicleta') toast(`Aviso: ${p} no tiene formato de placa colombiana. Verifíquela.`);
        espacioSel = null;
        renderEntrada();
        panel.insertAdjacentHTML('afterbegin', `<div class="alert info" style="margin-bottom:14px;justify-content:space-between;align-items:center">
          <span>${icon.check} ${placa(p)} en <b>${esc(r.espacio)}</b> a las ${hora(new Date())}</span>
          <button class="btn sm" id="tiq">${icon.print} Tiquete</button></div>`);
        panel.querySelector('#tiq').onclick = () => mostrarRecibo(r.id);
        await refrescar(true);
      } catch (err) { fail(err); } finally { btn.disabled = false; }
    };
    f.placa.focus({ preventScroll: true });
  }

  function paintEspacioSel() {
    const box = panel.querySelector('#espInfo');
    if (!box) return;
    const libres = espacios.filter((e) => e.tipo_vehiculo === tipo && e.estado === 'disponible').length;
    box.innerHTML = espacioSel
      ? `<div class="alert info" style="justify-content:space-between;align-items:center"><span>Espacio elegido: <b>${esc(espacioSel.codigo)}</b></span><button type="button" class="btn sm ghost" id="quitarEsp">Asignar automático</button></div>`
      : libres
        ? `<div class="small muted"><b style="color:var(--libre)">${libres} cupo${libres === 1 ? '' : 's'} libre${libres === 1 ? '' : 's'}</b> para ${TIPOS[tipo].toLowerCase()}. El espacio se asigna solo, o toque uno en el mapa.</div>`
        : `<div class="alert err"><b>Sin cupos para ${TIPOS[tipo].toLowerCase()}.</b>&nbsp;${espacios.some((e) => e.tipo_vehiculo === tipo && e.estado === 'reservado') ? 'Solo quedan espacios reservados: tóquelos en el mapa si corresponde.' : 'Espere a que salga un vehículo.'}</div>`;
    box.querySelector('#quitarEsp')?.addEventListener('click', () => { espacioSel = null; paintEspacioSel(); });
  }

  // --------------------------------------------------------------- SALIDA
  function renderSalida() {
    panel.innerHTML = `
      <form id="fBuscar" class="stack" autocomplete="off">
        <label class="f"><span>Placa del vehículo que sale</span>
          <input class="input plate" name="placa" maxlength="8" placeholder="ABC123" required></label>
        <button class="btn primary block" type="submit">${icon.search} Buscar y calcular cobro</button>
      </form>
      <div id="cobro" style="margin-top:16px"></div>`;
    const f = panel.querySelector('#fBuscar');
    f.onsubmit = async (e) => {
      e.preventDefault();
      const p = normalizarPlaca(f.placa.value);
      if (!p) return;
      try {
        const r = await api.get('/movimientos/buscar-placa', { placa: p, sede_id: sede });
        salidaActual = r;
        paintCobro();
      } catch (err) { panel.querySelector('#cobro').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    };
    if (salidaActual) { f.placa.value = salidaActual.movimiento.placa; paintCobro(); } else f.placa.focus({ preventScroll: true });
  }

  async function abrirSalida(movId) {
    try {
      const [det, cot] = await Promise.all([api.get(`/movimientos/${movId}`), api.get(`/movimientos/${movId}/cotizar`)]);
      salidaActual = { movimiento: det.movimiento, cotizacion: cot.cotizacion };
      setTab('salida');
      el.querySelector('#panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { fail(e); }
  }

  function paintCobro() {
    const box = panel.querySelector('#cobro');
    if (!box || !salidaActual) return;
    const { movimiento: m, cotizacion: c } = salidaActual;
    let metodo = c.es_abonado ? 'abonado' : 'efectivo';
    box.innerHTML = `
      <div class="cobro">
        <div class="row between">${vehiculo(m.tipo_vehiculo, m.placa, m.propietario || m.abonado)} <span class="badge">Espacio ${esc(m.espacio || '-')}</span></div>
        <dl class="kv" style="margin:14px 0">
          <dt>Entrada</dt><dd>${momento(m.entrada_at)}</dd>
          <dt>Tiempo</dt><dd>${duracion(c.minutos)}</dd>
          ${c.es_abonado ? `<dt>Abonado</dt><dd>${esc(m.abonado || 'Sí')}</dd>` : ''}
        </dl>
        <div class="small muted">Total a cobrar</div>
        <div class="total">${money(c.valor)}</div>
        <div class="small muted" style="margin-bottom:14px">${esc(c.detalle)}</div>
        ${c.es_abonado ? '' : `<div class="small muted" style="font-weight:600;margin-bottom:6px">Método de pago</div>
          <div class="seg" id="metodos" style="margin-bottom:14px">${['efectivo', 'tarjeta', 'transferencia', 'app'].map((k) => `<button type="button" data-m="${k}" class="${k === metodo ? 'on' : ''}">${METODOS[k]}</button>`).join('')}</div>`}
        <button class="btn success lg block" id="btnSalida">${icon.out} Registrar salida${c.valor > 0 ? ' y cobrar ' + money(c.valor) : ''}</button>
        <button class="btn ghost block" id="btnCancelar" style="margin-top:6px">Cancelar</button>
      </div>`;
    box.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => {
      metodo = b.dataset.m;
      box.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b));
    });
    box.querySelector('#btnCancelar').onclick = () => { salidaActual = null; renderSalida(); };
    box.querySelector('#btnSalida').onclick = async (e) => {
      e.target.disabled = true;
      try {
        const r = await api.post(`/movimientos/${m.id}/salida`, { metodo_pago: metodo });
        ok(`Salida registrada: ${m.placa} · ${money(r.cobro.valor)}`);
        salidaActual = null;
        renderSalida();
        mostrarRecibo(m.id);
        await refrescar(true);
      } catch (err) { fail(err); e.target.disabled = false; }
    };
  }

  // ----------------------------------------------------------------- MAPA
  el.querySelectorAll('#tipoFiltro button').forEach((b) => b.onclick = () => {
    filtroTipo = b.dataset.t;
    el.querySelectorAll('#tipoFiltro button').forEach((x) => x.classList.toggle('on', x === b));
    paintMapa();
  });

  // Ver en 3D: se inclina el plano que ya está dibujado (la transición solo ocurre al tocar el botón)
  el.querySelector('#ver3d').onclick = () => {
    en3d = !en3d;
    try { localStorage.setItem('sigpar_plano_3d', en3d ? '1' : '0'); } catch { /* sin almacenamiento */ }
    el.querySelector('.plano-vivo')?.classList.toggle('en3d', en3d);
    const b = el.querySelector('#ver3d');
    b.classList.toggle('on', en3d);
    b.setAttribute('aria-pressed', String(en3d));
    b.innerHTML = `${icon.cubo} ${en3d ? 'Ver plano' : 'Ver en 3D'}`;
  };

  el.querySelectorAll('#vistaMapa button').forEach((b) => b.onclick = () => {
    vista = b.dataset.v;
    try { localStorage.setItem('sigpar_vista_mapa', vista); } catch { /* sin almacenamiento */ }
    paintMapa();
  });

  function paintMapa() {
    // Los espacios inactivos (retirados al bajar la capacidad) no se muestran en la operación.
    const lista = espacios.filter((e) => e.estado !== 'inactivo' && (!filtroTipo || e.tipo_vehiculo === filtroTipo));
    const cuenta = (est) => espacios.filter((e) => e.estado === est).length;
    el.querySelector('#mapTitle').innerHTML = `Parqueadero <span class="small muted" style="font-weight:500">${cuenta('disponible')} libres, ${cuenta('ocupado')} ocupados${cuenta('reservado') ? `, ${cuenta('reservado')} reservados` : ''}</span>`;
    const selVista = el.querySelector('#vistaMapa');
    selVista.querySelector('[data-v="plano"]').classList.toggle('hidden', !plano);
    if (vista === 'plano' && !plano) vista = 'lista';
    const usarPlano = plano && vista === 'plano';
    selVista.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === vista));
    el.querySelector('#nAct').textContent = activos.length;
    el.querySelector('#buscaAct').classList.toggle('hidden', vista !== 'vehiculos');
    const b3d = el.querySelector('#ver3d');
    b3d.classList.toggle('hidden', !usarPlano);
    b3d.classList.toggle('on', en3d);
    b3d.setAttribute('aria-pressed', String(en3d));
    b3d.innerHTML = `${icon.cubo} ${en3d ? 'Ver plano' : 'Ver en 3D'}`;
    if (vista === 'vehiculos') return paintActivos();
    if (!lista.length) { el.querySelector('#mapa').innerHTML = '<div class="empty">No hay espacios configurados en esta sede.' + (esAdmin ? ' <a href="#/espacios">Crear espacios</a>' : '') + '</div>'; return; }
    const ahora = Date.now() + desfase; // hora del servidor, no la del dispositivo

    // Espacios que cambiaron desde el último dibujo: se resaltan un instante
    const cambios = new Set();
    if (estadoPrevio) espacios.forEach((e) => { if (estadoPrevio.get(e.id) !== undefined && estadoPrevio.get(e.id) !== e.estado) cambios.add(e.id); });
    estadoPrevio = new Map(espacios.map((e) => [e.id, e.estado]));

    if (usarPlano) {
      // Plano dibujado por el administrador; el filtro por tipo atenúa los demás en vez de esconderlos
      const fuera = espacios.filter((e) => e.estado !== 'inactivo' && e.plano_x === null).length;
      el.querySelector('#mapa').innerHTML = `
        <div class="plano-vivo${filtroTipo ? ' filtro-' + filtroTipo : ''}${en3d ? ' en3d' : ''}">${svgPlano(plano, espacios, { modo: 'vivo', ahora, elegido: espacioSel?.id, cambios })}</div>
        ${fuera ? `<p class="small muted" style="margin:10px 0 0">${fuera} espacio${fuera === 1 ? '' : 's'} sin ubicar en el plano: están en la vista Lista.${esAdmin ? ' <a href="#/plano">Ubicarlos</a>' : ''}</p>` : ''}`;
      el.querySelectorAll('#mapa [data-esp]').forEach((g) => g.addEventListener('click', () => clickEspacio(espacios.find((x) => String(x.id) === g.dataset.esp))));
      return;
    }
    const grupos = Object.keys(TIPOS).map((t) => [t, lista.filter((e) => e.tipo_vehiculo === t)]).filter(([, l]) => l.length);
    el.querySelector('#mapa').innerHTML = grupos.map(([t, l]) => `
      <div class="spot-group"><h4>${TIPOS[t]}s · ${l.filter((e) => e.estado === 'disponible').length ? `${l.filter((e) => e.estado === 'disponible').length} libres de ${l.length}` : '<span style="color:var(--ocupado)">sin cupos</span>'}</h4><div class="spots">
        ${l.map((e) => `<button class="spot ${e.estado}${cambios.has(e.id) ? ' cambio' : ''}" data-id="${e.id}" title="${esc(e.codigo)} · ${e.estado}${e.nota ? ' · ' + esc(e.nota) : ''}">
          ${icon[e.tipo_vehiculo]}<span class="code">${esc(e.codigo)}</span>
          ${e.estado === 'ocupado' ? `<span class="pl">${esc(e.placa)}</span><span class="info">${duracion(minutosDesde(e.entrada_at, ahora))}</span>`
            : `<span class="info">${e.estado === 'disponible' ? 'Libre' : e.estado === 'reservado' ? 'Reservado' : 'Inactivo'}</span>`}
          ${espacioSel?.id === e.id ? '<span class="badge blue">Elegido</span>' : ''}
        </button>`).join('')}
      </div></div>`).join('');
    el.querySelectorAll('.spot').forEach((b) => b.onclick = () => clickEspacio(espacios.find((x) => x.id == b.dataset.id)));
  }

  async function clickEspacio(e) {
    if (!e) return;
    if (e.estado === 'ocupado') return abrirSalida(e.movimiento_id);
    if (e.estado === 'disponible' && tab === 'entrada' && !esAdmin) return elegir(e);

    const acciones = [];
    if (['disponible', 'reservado'].includes(e.estado)) acciones.push({ label: `${icon.in} Usar para entrada`, cls: 'success', onClick: () => elegir(e) });
    if (e.estado === 'disponible') acciones.push({ label: 'Reservar', onClick: () => cambiarEstado(e, 'reservado') });
    if (e.estado === 'reservado') acciones.push({ label: 'Liberar reserva', onClick: () => cambiarEstado(e, 'disponible') });
    if (esAdmin && e.estado !== 'inactivo') acciones.push({ label: 'Inhabilitar', onClick: () => cambiarEstado(e, 'inactivo') });
    if (esAdmin && e.estado === 'inactivo') acciones.push({ label: 'Habilitar', cls: 'primary', onClick: () => cambiarEstado(e, 'disponible') });
    if (!acciones.length) return;
    modal({
      title: `Espacio ${e.codigo}`,
      body: `<p style="margin:0">${TIPOS[e.tipo_vehiculo]} · estado <b>${e.estado}</b>${e.nota ? `<br><span class="muted">${esc(e.nota)}</span>` : ''}</p>`,
      actions: [{ label: 'Cerrar' }, ...acciones],
    });
  }

  function elegir(e) {
    espacioSel = e;
    tipo = e.tipo_vehiculo;
    if (tab !== 'entrada') setTab('entrada'); else renderEntradaKeep();
    paintMapa();
  }
  function renderEntradaKeep() {
    const f = panel.querySelector('#fEntrada');
    const keep = f ? formData(f) : {};
    renderEntrada();
    const nf = panel.querySelector('#fEntrada');
    if (keep.placa) nf.placa.value = keep.placa;
    if (keep.propietario) nf.propietario.value = keep.propietario;
    if (keep.telefono) nf.telefono.value = keep.telefono;
    nf.autoriza_datos.checked = !!keep.autoriza_datos;
  }

  async function cambiarEstado(e, estado) {
    let nota = e.nota;
    if (estado === 'reservado') {
      const r = await modal({
        title: `Reservar ${e.codigo}`,
        body: '<label class="f"><span>Nota (para quién / hasta cuándo)</span><input class="input" name="nota" maxlength="200"></label>',
        actions: [{ label: 'Cancelar' }, { label: 'Reservar', cls: 'primary', onClick: (c, root) => ({ nota: root.querySelector('[name=nota]').value }) }],
      });
      if (!r) return;
      nota = r.nota;
    }
    if (estado === 'inactivo' && !(await confirmar('Inhabilitar espacio', `El espacio ${esc(e.codigo)} no se podrá usar hasta habilitarlo de nuevo.`))) return;
    await api.patch(`/espacios/${e.id}/estado`, { estado, nota: estado === 'disponible' ? null : nota });
    ok(`Espacio ${e.codigo}: ${estado}`);
    refrescar(true);
  }

  // -------------------------------------------------------- VEHÍCULOS DENTRO
  function paintActivos() {
    if (vista !== 'vehiculos') return;
    const q = el.querySelector('#buscaAct').value.trim().toLowerCase();
    const qp = normalizarPlaca(q);
    const lista = activos.filter((m) => (!filtroTipo || m.tipo_vehiculo === filtroTipo)
      && (!q || (qp && m.placa.includes(qp)) || (m.propietario || m.abonado || '').toLowerCase().includes(q)));
    el.querySelector('#mapa').innerHTML = lista.length ? `<div class="table-wrap op-tabla">
      <table class="t compacta"><thead><tr><th>Vehículo</th><th>Espacio</th><th>Entrada</th><th>Tiempo</th><th class="num">Lleva</th><th></th></tr></thead><tbody>
      ${lista.map((m) => `<tr>
        <td>${vehiculo(m.tipo_vehiculo, m.placa, m.propietario || m.abonado, { abonado: !!m.abonado_id })}</td>
        <td><b>${esc(m.espacio || '-')}</b></td><td>${momento(m.entrada_at)}</td><td>${duracion(m.minutos_actuales)}</td>
        <td class="num">${money(m.valor_actual)}</td>
        <td class="right"><button class="btn sm" data-sal="${m.id}">${icon.out} Salida</button></td></tr>`).join('')}
      </tbody></table></div>`
      : `<div class="empty">${activos.length ? 'Ningún vehículo coincide con la búsqueda.' : 'No hay vehículos dentro.'}</div>`;
    el.querySelectorAll('[data-sal]').forEach((b) => b.onclick = () => abrirSalida(b.dataset.sal));
  }
  el.querySelector('#buscaAct').oninput = paintActivos;

  // ------------------------------------------------------------ Tiempo real
  let firma = '';
  async function refrescar(forzar = false) {
    try {
      // Una sola petición trae el mapa y los vehículos dentro (la mitad de carga para el servidor)
      const r = await api.get('/operacion/estado', { sede_id: sede });
      if (r.servidor_hora) desfase = new Date(r.servidor_hora.replace(' ', 'T')).getTime() - Date.now();
      // Solo se redibuja si algo cambió (o cambió el minuto, para actualizar los tiempos): ahorra batería en el celular
      const nueva = JSON.stringify([r.espacios.map((e) => [e.id, e.estado, e.movimiento_id, e.codigo, e.nota]), r.activos.map((m) => [m.id, m.valor_actual]), Math.floor(Date.now() / 60000)]);
      espacios = r.espacios;
      activos = r.activos;
      // El plano solo se descarga cuando el administrador lo cambia (se compara su versión)
      const version = r.planos?.[String(sede)];
      const antes = plano;
      plano = version ? await planoDeSede(sede, version).catch(() => plano) : null;
      if (plano !== antes) forzar = true;
      if (espacioSel) espacioSel = espacios.find((x) => x.id === espacioSel.id && ['disponible', 'reservado'].includes(x.estado)) || null;
      // La salida que se está cobrando ya se registró desde otro equipo (la app u otro operador)
      if (salidaActual && !activos.some((m) => m.id === salidaActual.movimiento.id)) {
        toast(`${salidaActual.movimiento.placa} ya registró su salida desde otro equipo`);
        salidaActual = null;
        if (tab === 'salida') renderSalida();
      }
      if (forzar === true || nueva !== firma) { firma = nueva; paintMapa(); paintEspacioSel(); }
      ctx.live(true);
    } catch (err) { ctx.live(false); }
  }

  setTab('entrada');
  await refrescar();
  // Los cambios hechos desde la app Android u otro operador llegan por el aviso de cambios (unos 4 s);
  // además se refresca cada 30 s para que corran los tiempos y los valores acumulados.
  ctx.alCambiar(() => refrescar());
  ctx.every(refrescar, 30000);
  // Mantener actualizado el valor del cobro mientras se muestra
  ctx.every(async () => {
    if (tab !== 'salida' || !salidaActual) return;
    try {
      const c = await api.get(`/movimientos/${salidaActual.movimiento.id}/cotizar`);
      if (c.cotizacion.valor !== salidaActual.cotizacion.valor) { salidaActual.cotizacion = c.cotizacion; paintCobro(); }
    } catch { /* el movimiento pudo cerrarse desde la app */ }
  }, 30000);
}
