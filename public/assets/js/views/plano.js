/**
 * Editor del plano del parqueadero (solo administradores).
 *
 * El administrador dibuja su lote como es en realidad: vías, entrada, salida, columnas, zonas donde
 * no se parquea, y ubica cada espacio donde está. Sirve para parqueaderos irregulares (esquinas,
 * sótanos, espacios en diagonal a una columna...). La operación en web y app muestra este plano en vivo.
 */
import { api, request } from '../api.js';
import { esc, icon, TIPOS, ok, fail, toast, modal, confirmar, loading } from '../ui.js';
import { svgPlano, huella, PIEZAS, olvidarPlano } from '../plano.js';
import { OPCIONES_BASE, CELDA_M, MAX_LADO, NOMBRE_DIR, interpretar, generarPlano, asignar } from '../plano-asistente.js';
import { iniciarTour, yaVisto } from '../tour.js';
import { leerImagenPlano } from '../plano-foto.js';

const DIBUJABLES = ['via', 'entrada', 'salida', 'zona', 'muro', 'caseta'];

export default async function (el, ctx) {
  if (!ctx.sedeId) {
    el.innerHTML = `
      <div class="page-head"><div><h1>Plano del parqueadero</h1><p>Elija la sede cuyo plano quiere dibujar.</p></div></div>
      <div class="grid g3">${ctx.sedes.map((s) => `
        <button class="card kpi" data-s="${s.id}"><div class="label">${icon.sedes} Sede</div>
        <div class="value" style="font-size:20px;font-family:var(--font)">${esc(s.nombre)}</div><div class="sub">Dibujar su plano</div></button>`).join('')}</div>`;
    el.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => ctx.setSede(b.dataset.s));
    return;
  }
  const sede = ctx.sedeId;
  el.innerHTML = loading();

  let plano = null;           // { ancho, alto, elementos }
  let espacios = [];          // espacios de la sede con su ubicación
  let nuevos = [];            // espacios dibujados que aún no existen en el servidor
  let herramienta = 'mover';
  let rotNuevo = 0;
  let sel = null;             // { tipo: 'el', i } | { tipo: 'esp', clave }
  let zoom = 1;
  let historial = [];
  let sucio = false;
  let arrastre = null;
  let tmp = 0;
  let fondo = null;           // foto o boceto de calco { img, url, x, y, w, h, op }
  let fondoCambio = false;    // la foto solo viaja al servidor cuando cambió
  let ia = false;             // el servidor puede leer fotos con IA

  try {
    const r = await api.get(`/sedes/${sede}/plano`, { fondo: 1 });
    plano = r.plano;
    espacios = r.espacios;
    ia = !!r.ia;
    if (r.fondo?.img) fondo = { ...r.fondo, url: urlDeDatos(r.fondo.img) };
  } catch (e) { el.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; return; }

  const todos = () => [...espacios, ...nuevos];
  const buscar = (clave) => todos().find((e) => String(e.id ?? e.tmp) === String(clave));
  const sinUbicar = () => espacios.filter((e) => e.plano_x === null && e.estado !== 'inactivo');

  // ------------------------------------------------------------ Historial (deshacer)
  const foto = () => JSON.stringify({ plano, pos: espacios.map((e) => [e.plano_x, e.plano_y, e.plano_rot]), nuevos });
  function guardarPaso() {
    historial.push(foto());
    if (historial.length > 80) historial.shift();
    marcarSucio();
  }
  function deshacer() {
    const f = historial.pop();
    if (!f) return toast('No hay nada que deshacer');
    const d = JSON.parse(f);
    plano = d.plano; nuevos = d.nuevos;
    espacios.forEach((e, i) => { [e.plano_x, e.plano_y, e.plano_rot] = d.pos[i]; });
    sel = null;
    marcarSucio();
    pintar();
  }
  function marcarSucio() {
    sucio = true;
    const b = el.querySelector('#guardar');
    if (b) { b.disabled = false; b.classList.add('pendiente'); }
  }

  // ------------------------------------------------------------ Geometría
  function cabe(clave, tipo, x, y, rot) {
    const [w, h] = huella(tipo, rot);
    if (x < 0 || y < 0 || x + w > plano.ancho || y + h > plano.alto) return { ok: false, motivo: 'Queda por fuera del lote' };
    for (const o of todos()) {
      if (o.plano_x === null || String(o.id ?? o.tmp) === String(clave)) continue;
      const [ow, oh] = huella(o.tipo_vehiculo, +o.plano_rot);
      if (x < +o.plano_x + ow && x + w > +o.plano_x && y < +o.plano_y + oh && y + h > +o.plano_y) {
        return { ok: false, motivo: `Ese lugar ya lo ocupa ${o.codigo || 'otro espacio nuevo'}` };
      }
    }
    return { ok: true };
  }
  /** Primer lugar libre (sin espacios ni vías/muros/columnas debajo), recorriendo el lote por filas. */
  function lugarLibre(tipo, rot) {
    const [w, h] = huella(tipo, rot);
    const bloquea = (plano.elementos || []).filter((p) => ['via', 'muro', 'columna', 'entrada', 'salida', 'caseta', 'zona'].includes(p.t));
    for (let y = 0; y + h <= plano.alto; y++) {
      for (let x = 0; x + w <= plano.ancho; x++) {
        if (!cabe(null, tipo, x, y, rot).ok) continue;
        if (bloquea.some((p) => x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + h > p.y)) continue;
        return { x, y };
      }
    }
    return null;
  }

  // ------------------------------------------------------------ Foto o boceto de calco
  /** Convierte la foto a JPG liviano (máx. 1568 px por lado): viaja rápido y la IA la lee bien. */
  async function leerImagen(file) {
    if (!file || !/^image\//.test(file.type)) throw new Error('Elija una imagen: foto, captura o boceto en JPG o PNG.');
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('No se pudo abrir la imagen. Use una foto JPG o PNG.'));
        i.src = url;
      });
      const k = Math.min(1, 1568 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      const datos = c.toDataURL('image/jpeg', 0.82);
      return { img: datos, url: urlDeDatos(datos), ancho: c.width, alto: c.height };
    } finally { URL.revokeObjectURL(url); }
  }
  /** La foto se dibuja con una URL corta (blob) y se guarda como texto (data URL). */
  function urlDeDatos(datos) {
    const [cab, b64] = datos.split(',');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: cab.slice(5).split(';')[0] }));
  }
  /** Ubica la foto centrada en el lote sin deformarla. */
  function encajar(f, p, op = 0.5) {
    const a = f.ancho / f.alto;
    let w = p.ancho, h = p.ancho / a;
    if (h > p.alto) { h = p.alto; w = p.alto * a; }
    return { img: f.img, url: f.url, ancho: f.ancho, alto: f.alto, x: +((p.ancho - w) / 2).toFixed(2), y: +((p.alto - h) / 2).toFixed(2), w: +w.toFixed(2), h: +h.toFixed(2), op };
  }

  // ------------------------------------------------------------ Asistente: describir el parqueadero
  function contarExistentes() {
    const c = { carro: 0, moto: 0, bicicleta: 0 };
    espacios.forEach((e) => { if (e.estado !== 'inactivo' && c[e.tipo_vehiculo] !== undefined) c[e.tipo_vehiculo]++; });
    return c;
  }

  const EJEMPLOS = [
    ['Lote pequeño', 'Lote de 20 x 30 metros con 18 carros y 10 motos. Se entra y se sale por el frente.'],
    ['Sótano', 'Sótano con 40 cupos para carros, columnas, entrada por la izquierda y salida por el lado opuesto. Motos al fondo.'],
    ['Lote angosto', 'Lote angosto de 12 metros de ancho y 50 de largo, con 20 carros. Entrada y salida por la calle.'],
    ['Alrededor', 'Los carros se parquean alrededor del lote, contra las paredes, y en una isla en el centro. Unos 35 carros y 8 motos.'],
  ];

  /**
   * Pantalla del asistente. El administrador describe su parqueadero con sus palabras (o adjunta una foto)
   * y ve el plano armándose mientras escribe. desdeEditor: ya había plano y quiere rehacerlo.
   */
  function asistente(desdeEditor = false) {
    const existentes = contarExistentes();
    let desdeTexto = {};
    let manual = {};
    let op = { ...OPCIONES_BASE };
    let entendi = [];
    let foto = fondo ? { img: fondo.img, url: fondo.url, ancho: fondo.ancho || fondo.w, alto: fondo.alto || fondo.h } : null;
    let propuestaImg = null;   // plano sacado de la foto: { origen: 'foto' | 'ia', ancho, alto, elementos, espacios, ... }
    let lecturaError = null;   // por qué no se pudo leer la imagen (para explicarlo)
    let leyendo = false;
    let temporizador = 0;
    const recalcular = () => { op = { ...OPCIONES_BASE, ...desdeTexto, ...manual }; };

    const campoNum = (k, etiqueta, ph) => `<label class="f"><span>${etiqueta}</span><input class="input" type="number" inputmode="numeric" min="0" max="600" data-k="${k}" placeholder="${esc(ph)}"></label>`;
    const seg = (k, opciones) => `<div class="seg" data-seg="${k}">${opciones.map(([v, t]) => `<button type="button" data-v="${v}">${t}</button>`).join('')}</div>`;

    el.innerHTML = `
      <div class="page-head">
        <div><h1>${desdeEditor ? 'Rehacer el plano' : 'Plano del parqueadero'}</h1>
          <p>${esc(ctx.sedeNombre)}. Suba una foto o un boceto de su parqueadero y el plano se arma solo. Si no tiene foto, descríbalo con sus palabras.</p></div>
        <div class="row">
          ${desdeEditor ? `<button class="btn" id="volver">${icon.atras} Volver al editor</button>` : ''}
          <button class="btn" id="ayuda">${icon.ayuda} Cómo funciona</button>
        </div>
      </div>
      <div class="asis">
        <section class="card asis-foto" id="fotoCard"><div class="card-b stack" id="fotoB"></div></section>

        <section class="card asis-desc"><div class="card-b stack">
          <div class="asis-paso"><span>2</span><div><h3>¿No tiene foto? Descríbalo</h3><p class="small muted">Medidas, cuántos carros y motos, por dónde se entra y se sale.</p></div></div>
          <textarea class="input" id="desc" rows="4" maxlength="1500" placeholder="Ejemplo: lote de 30 x 45 metros con 40 carros y 12 motos. La entrada es por la izquierda y la salida por el lado opuesto. Tiene columnas."></textarea>
          <div class="asis-ejemplos"><span class="small muted">Pruebe un ejemplo:</span>
            ${EJEMPLOS.map(([t], i) => `<button type="button" class="chip" data-ej="${i}">${t}</button>`).join('')}</div>
          <div class="asis-entendi" id="entendi" aria-live="polite"></div>
        </div></section>

        <section class="card asis-vista" id="vista">
          <div class="asis-vista-cab"><h3>Así quedaría</h3><div class="asis-resumen" id="resumen"></div></div>
          <div class="asis-lienzo" id="previa"></div>
          <div class="asis-avisos" id="avisos"></div>
          <div class="asis-acciones">
            <button class="btn primary" id="guardarYa">${icon.guardar} Guardar este plano</button>
            <button class="btn" id="usar">${icon.cursor} Ajustar a mano primero</button>
            <button class="btn ghost" id="blanco">Empezar en blanco</button>
          </div>
        </section>

        <section class="card asis-det" id="detalles"><div class="card-b stack">
          <div class="asis-paso"><span>3</span><div><h3>Revise los detalles</h3><p class="small muted">Lo que no diga en el texto, lo elige aquí. Vacío = lo que tiene hoy la sede.</p></div></div>
          <div class="asis-campos">
            ${campoNum('carros', 'Carros', `${existentes.carro} hoy`)}
            ${campoNum('motos', 'Motos', `${existentes.moto} hoy`)}
            ${campoNum('bicis', 'Bicicletas', `${existentes.bicicleta} hoy`)}
          </div>
          <div class="asis-campos dos">
            <label class="f"><span>Ancho del lote (m)</span><input class="input" type="number" inputmode="decimal" min="10" max="200" data-k="anchoM" placeholder="Automático"></label>
            <label class="f"><span>Largo del lote (m)</span><input class="input" type="number" inputmode="decimal" min="10" max="200" data-k="largoM" placeholder="Automático"></label>
          </div>
          <div class="f"><span>Cómo se acomodan</span>${seg('forma', [['filas', 'En filas'], ['angosto', 'Lote angosto'], ['perimetro', 'Alrededor']])}</div>
          <div class="f"><span>La entrada está</span>${seg('entrada', [['izq', 'A la izquierda'], ['der', 'A la derecha'], ['arriba', 'Arriba'], ['abajo', 'Abajo']])}</div>
          <div class="f"><span>Se sale por</span>${seg('salida', [['misma', 'La misma entrada'], ['opuesta', 'El lado opuesto']])}</div>
          <div class="f" id="fChicos"><span>Motos y bicicletas</span>${seg('chicos', [['fondo', 'Al fondo'], ['entrada', 'Junto a la entrada']])}</div>
          <div class="asis-checks">
            <label class="check"><input type="checkbox" data-k="columnas"> Tiene columnas (sótano o edificio)</label>
            <label class="check"><input type="checkbox" data-k="caseta"> Caja junto a la entrada</label>
          </div>
        </div></section>
      </div>`;

    const $ = (s) => el.querySelector(s);
    $('#ayuda').onclick = () => iniciarTour('plano', ctx);
    $('#volver')?.addEventListener('click', () => montar());

    // ---------- Formulario <-> opciones
    function pintarCampos() {
      el.querySelectorAll('input[data-k]').forEach((i) => {
        const v = op[i.dataset.k];
        if (i.type === 'checkbox') i.checked = !!v;
        else if (i !== document.activeElement) i.value = v ?? '';
      });
      el.querySelectorAll('[data-seg]').forEach((g) => g.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === op[g.dataset.seg])));
      $('#fChicos').hidden = op.forma === 'perimetro';
      $('#detalles').classList.toggle('apagado', !!propuestaImg);
      el.querySelector('.asis-desc').classList.toggle('apagado', !!propuestaImg);
    }
    el.querySelectorAll('input[data-k]').forEach((i) => {
      const k = i.dataset.k;
      i.addEventListener(i.type === 'checkbox' ? 'change' : 'input', () => {
        if (i.type === 'checkbox') manual[k] = i.checked;
        else manual[k] = i.value === '' ? null : Math.max(0, +i.value);
        propuestaImg = null;
        recalcular(); pintarCampos(); vistaPrevia();
      });
    });
    el.querySelectorAll('[data-seg]').forEach((g) => g.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-v]');
      if (!b) return;
      manual[g.dataset.seg] = b.dataset.v;
      propuestaImg = null;
      recalcular(); pintarCampos(); vistaPrevia();
    }));

    // ---------- Texto libre
    function leerTexto() {
      const r = interpretar($('#desc').value);
      // Lo que el texto menciona manda sobre lo que se había ajustado a mano
      Object.keys(r.cambios).forEach((k) => delete manual[k]);
      desdeTexto = r.cambios;
      entendi = r.entendi;
      recalcular(); pintarCampos(); pintarEntendi(); vistaPrevia();
    }
    $('#desc').addEventListener('input', () => { clearTimeout(temporizador); temporizador = setTimeout(leerTexto, 220); });
    el.querySelectorAll('[data-ej]').forEach((b) => b.onclick = () => {
      $('#desc').value = EJEMPLOS[+b.dataset.ej][1];
      manual = {};
      propuestaImg = null;
      leerTexto();
    });
    let yaEntendido = new Set();
    function pintarEntendi() {
      const cont = $('#entendi');
      if (!entendi.length) {
        cont.innerHTML = $('#desc').value.trim() ? '<span class="small muted">Aún no reconozco medidas ni cantidades. Pruebe con números: "30 carros", "lote de 20 x 40 m".</span>' : '';
        yaEntendido = new Set();
        return;
      }
      // Solo lo recién entendido entra con animación; lo demás se queda quieto
      cont.innerHTML = `<span class="small muted">Entendí:</span>${entendi.map((t) => `<span class="chip ok${yaEntendido.has(t) ? '' : ' entra'}">${icon.listo}${esc(t)}</span>`).join('')}`;
      yaEntendido = new Set(entendi);
    }

    // ---------- Foto o boceto (la forma principal: el plano se arma solo)
    function pintarFoto() {
      const b = $('#fotoB');
      const paso = `<div class="asis-paso"><span>1</span><div><h3>Suba una foto o un boceto</h3><p class="small muted">Lo más fácil: reconocemos los puestos y armamos el plano solos, sin acomodar nada a mano.</p></div></div>`;
      if (!foto) {
        b.innerHTML = `${paso}
          <label class="asis-drop grande" id="drop" tabindex="0">
            <input type="file" accept="image/*" id="archivo" hidden>
            <span class="asis-drop-ic">${icon.subir}</span>
            <span><b>Subir foto o boceto</b><span class="small muted">Arrástrela aquí o toque para elegirla. En el celular puede tomarla con la cámara.</span></span>
          </label>
          <details class="asis-consejos">
            <summary>${icon.idea} Cómo dibujar el boceto para que salga bien</summary>
            <div class="asis-consejos-c">
              <svg viewBox="0 0 120 70" class="asis-mini" aria-hidden="true">
                ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${8 + i * 17}" y="6" width="15" height="22" rx="1"/>`).join('')}
                ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${8 + i * 17}" y="42" width="15" height="22" rx="1"/>`).join('')}
                <path d="M2 35 H 116" class="v"/>
              </svg>
              <ul>
                <li>Cada puesto, un cuadro o rectángulo <b>cerrado</b>.</li>
                <li>Lapicero o marcador oscuro sobre hoja blanca.</li>
                <li>Las vías, en blanco (sin dibujar nada).</li>
                <li>Los puestos de moto, más pequeños que los de carro.</li>
                <li>Foto de frente, con buena luz y la hoja completa.</li>
              </ul>
            </div>
          </details>`;
        const drop = $('#drop');
        $('#archivo').onchange = (ev) => adjuntar(ev.target.files[0]);
        drop.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); $('#archivo').click(); } });
        ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (ev) => { ev.preventDefault(); drop.classList.add('sobre'); }));
        ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('sobre')));
        drop.addEventListener('drop', (ev) => { ev.preventDefault(); adjuntar(ev.dataTransfer.files[0]); });
        return;
      }
      const d = propuestaImg?.detectados;
      const estado = leyendo ? `<p class="small" style="margin:0"><span class="spinner" style="width:14px;height:14px"></span> Leyendo la imagen...</p>`
        : propuestaImg ? `<p class="asis-ok" style="margin:0">${icon.listo}<span>${propuestaImg.origen === 'ia' ? `La IA encontró <b>${propuestaImg.espacios.length} puestos</b>` : `Encontramos <b>${d.carro} puesto${d.carro === 1 ? '' : 's'} de carro</b>${d.moto ? ` y <b>${d.moto} de moto</b>` : ''}${d.zona ? `, y ${d.zona} zona${d.zona === 1 ? '' : 's'} sin parqueo` : ''}`}. Mire cómo quedó.</span></p>`
          : lecturaError ? `<div class="alert warn" style="margin:0">${icon.warning}<span>${esc(lecturaError)}</span></div>` : '';
      b.innerHTML = `${paso}
        <div class="asis-foto-fila">
          <img src="${esc(foto.url)}" alt="Imagen del parqueadero">
          <div class="stack" style="gap:8px;min-width:0">
            ${estado}
            <div class="row" style="gap:8px">
              <label class="btn sm">${icon.camera} Cambiar imagen<input type="file" accept="image/*" id="archivo2" hidden></label>
              ${ia ? `<button class="btn sm" id="leerIA" ${leyendo ? 'disabled' : ''}>${icon.magia} Leer con IA</button>` : ''}
              <button class="btn sm ghost" id="quitarFoto" ${leyendo ? 'disabled' : ''}>${icon.trash} Quitar</button>
            </div>
          </div>
        </div>
        ${ia ? '<p class="small muted" style="margin:0">Si es una foto real del parqueadero (no un boceto) y no la reconocimos bien, pruebe "Leer con IA".</p>' : ''}`;
      $('#archivo2').onchange = (ev) => adjuntar(ev.target.files[0]);
      $('#quitarFoto').onclick = () => { foto = null; propuestaImg = null; lecturaError = null; pintarFoto(); pintarCampos(); vistaPrevia(); };
      $('#leerIA')?.addEventListener('click', leerConIA);
    }
    async function adjuntar(file) {
      if (!file) return;
      try {
        foto = await leerImagen(file);
      } catch (e) { return fail(e); }
      // Se lee de una vez: el administrador no tiene que hacer nada más
      leyendo = true; propuestaImg = null; lecturaError = null;
      pintarFoto();
      $('#previa').classList.add('leyendo');
      try {
        const r = await leerImagenPlano(foto.url);
        if (r.ok) propuestaImg = { ...r, origen: 'foto' };
        else lecturaError = r.motivo;
      } catch { lecturaError = 'No pudimos leer esa imagen. Pruebe con otra foto.'; }
      leyendo = false;
      $('#previa').classList.remove('leyendo');
      pintarFoto(); pintarCampos(); vistaPrevia();
      if (propuestaImg) el.querySelector('#vista').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
    }
    async function leerConIA() {
      leyendo = true;
      pintarFoto();
      $('#previa').classList.add('leyendo');
      try {
        const r = await request('POST', `/sedes/${sede}/plano/interpretar`, { imagen: foto.img, texto: $('#desc').value.trim() }, { timeout: 120000 });
        propuestaImg = { ...r.propuesta, origen: 'ia' };
        lecturaError = null;
      } catch (e) { fail(e); }
      leyendo = false;
      $('#previa').classList.remove('leyendo');
      pintarFoto(); pintarCampos(); vistaPrevia();
    }

    // ---------- Vista previa
    let actual = null;
    function calcular() {
      if (propuestaImg) {
        const p = propuestaImg;
        return { plano: { ancho: p.ancho, alto: p.alto, elementos: p.elementos }, slots: p.espacios.map((e) => ({ tipo: e.tipo, x: e.x, y: e.y, rot: e.rot })), faltan: null, origen: p.origen, notas: p.notas };
      }
      return generarPlano(op, existentes);
    }
    function vistaPrevia() {
      const g = calcular();
      const rep = asignar(g.slots, espacios);
      const previa = [
        ...espacios.filter((e) => rep.pos.has(String(e.id))).map((e) => { const p = rep.pos.get(String(e.id)); return { ...e, plano_x: p.x, plano_y: p.y, plano_rot: p.rot }; }),
        ...rep.nuevos.map((n, i) => ({ ...n, tmp: 'p' + i, nuevo: true, codigo: '', estado: 'disponible' })),
      ];
      actual = { ...g, rep };
      // Si el plano salió de la imagen, la foto no va detrás (ya está "pasada en limpio" y podría verse torcida)
      $('#previa').innerHTML = svgPlano(g.plano, previa, { modo: 'editor', ajustar: true, fondo: foto && !g.origen ? encajar(foto, g.plano, 0.45) : null });

      const c = g.slots.reduce((a, s) => { a[s.tipo]++; return a; }, { carro: 0, moto: 0, bicicleta: 0 });
      const partes = [[c.carro, 'carros'], [c.moto, 'motos'], [c.bicicleta, 'bicis']].filter(([v]) => v).map(([v, t]) => `${v} ${t}`);
      $('#resumen').innerHTML = `
        <span class="badge">${partes.join(' · ') || 'Sin espacios'}</span>
        <span class="badge">${Math.round(g.plano.ancho * CELDA_M)} x ${Math.round(g.plano.alto * CELDA_M)} m</span>
        ${rep.nuevos.length ? `<span class="badge blue">${rep.nuevos.length} nuevos</span>` : ''}`;

      const avisos = [];
      if (g.origen) avisos.push(`<div class="alert info">${icon.magia}<span>Plano armado desde su imagen${g.origen === 'ia' ? ' con IA' : ''}. Mire que se parezca a su parqueadero; si está bien, toque Guardar este plano. <button class="link" id="descartarIA">Mejor usar la descripción</button></span></div>`);
      if (g.faltan && (g.faltan.carro || g.faltan.moto || g.faltan.bicicleta)) {
        const f = [[g.faltan.carro, 'carros'], [g.faltan.moto, 'motos'], [g.faltan.bicicleta, 'bicicletas']].filter(([v]) => v > 0).map(([v, t]) => `${v} ${t}`);
        const lote = op.anchoM && op.largoM ? `un lote de ${op.anchoM} x ${op.largoM} m` : 'el lote indicado';
        avisos.push(`<div class="alert warn">${icon.warning}<span>No caben ${f.join(' y ')} en ${lote}. Agrande el lote, quite las columnas o pruebe otra forma de acomodarlos.</span></div>`);
      }
      if (g.entradaMovida) avisos.push(`<div class="alert info">${icon.info}<span>En un lote angosto la vía va a lo largo, así que la entrada quedó ${NOMBRE_DIR[g.entradaMovida]}.</span></div>`);
      const su = rep.sinUbicar;
      const nSin = su.carro + su.moto + su.bicicleta;
      if (nSin) {
        const det = [[su.carro, 'de carro'], [su.moto, 'de moto'], [su.bicicleta, 'de bicicleta']].filter(([v]) => v).map(([v, t]) => `${v} ${t}`).join(', ');
        avisos.push(`<p class="small muted" style="margin:0">La sede tiene más espacios de los que ${g.origen ? 'aparecen en la imagen' : 'caben aquí'}: ${det} quedan sin ubicar. Los operadores los siguen viendo en la lista; si sobran, bájelos en <a href="#/espacios">Espacios</a>.</p>`);
      }
      if (rep.nuevos.length) avisos.push(`<p class="small muted" style="margin:0">Los espacios con borde punteado son nuevos: se crean con su código (C-25, M-09...) cuando guarde el plano.</p>`);
      $('#avisos').innerHTML = avisos.join('');
      $('#descartarIA')?.addEventListener('click', () => { propuestaImg = null; pintarFoto(); pintarCampos(); vistaPrevia(); });
    }

    // ---------- Usar
    function aplicar() {
      const g = actual;
      if (desdeEditor) guardarPaso();
      plano = JSON.parse(JSON.stringify(g.plano));
      espacios.forEach((e) => {
        const p = g.rep.pos.get(String(e.id));
        e.plano_x = p ? p.x : null; e.plano_y = p ? p.y : null; e.plano_rot = p ? p.rot : 0;
      });
      nuevos = g.rep.nuevos.map((n) => ({ ...n, tmp: 'n' + (++tmp), nuevo: true, codigo: '', estado: 'disponible' }));
      if (g.origen) { if (fondo) { fondo = null; fondoCambio = true; } } // plano leído de la imagen: sin calco
      else if (foto && (!fondo || fondo.img !== foto.img || desdeEditor)) { fondo = encajar(foto, plano); fondoCambio = true; }
      if (!foto && fondo) { fondo = null; fondoCambio = true; }
      sel = null;
      marcarSucio();
      montar();
    }
    // Lo más simple: se guarda de una vez y los operadores ya lo ven. Ajustar a mano es opcional.
    $('#guardarYa').onclick = async (ev) => {
      ev.currentTarget.disabled = true;
      aplicar();
      await guardar();
    };
    $('#usar').onclick = () => {
      aplicar();
      toast('Mueva lo que haga falta y toque Guardar plano.');
    };
    $('#blanco').onclick = () => {
      const a = Math.min(MAX_LADO, Math.max(8, Math.round((op.anchoM || 40) / CELDA_M)));
      const b = Math.min(MAX_LADO, Math.max(8, Math.round((op.largoM || 30) / CELDA_M)));
      if (desdeEditor) guardarPaso();
      plano = { ancho: a, alto: b, elementos: [{ t: 'entrada', x: 0, y: 2, w: 1, h: 3 }] };
      espacios.forEach((e) => { e.plano_x = null; e.plano_y = null; e.plano_rot = 0; });
      nuevos = [];
      if (foto) { fondo = encajar(foto, plano); fondoCambio = true; }
      sel = null;
      marcarSucio();
      montar();
      toast('Lote en blanco. Dibuje las vías y ubique los espacios desde la lista "Sin ubicar".');
    };

    recalcular();
    pintarCampos();
    pintarFoto();
    vistaPrevia();
    // La guía del plano se abre sola la primera vez, pero nunca encima del recorrido general
    if (!desdeEditor && !yaVisto('plano', ctx) && yaVisto('general', ctx)) {
      setTimeout(() => { if (el.isConnected && $('#desc') && !document.querySelector('.tour')) iniciarTour('plano', ctx); }, 700);
    }
  }

  // ------------------------------------------------------------ Editor
  const herramientas = () => `
    <div class="pl-grupo"><span>Editar</span>
      <button data-h="mover" title="Mover y seleccionar (Esc)">${icon.cursor}<b>Mover</b></button>
      <button data-h="borrar" title="Borrar: toque lo que quiera quitar">${icon.borrar}<b>Borrar</b></button>
      <button data-accion="deshacer" title="Deshacer (Ctrl+Z)">${icon.undo}<b>Deshacer</b></button>
    </div>
    <div class="pl-grupo"><span>Dibujar</span>
      ${Object.entries(PIEZAS).map(([k, p]) => `<button data-h="${k}" title="${esc(p.ayuda)}">${icon[p.icono]}<b>${p.nombre}</b></button>`).join('')}
    </div>
    <div class="pl-grupo"><span>Agregar espacio</span>
      ${Object.entries(TIPOS).map(([k, v]) => `<button data-h="esp:${k}" title="Toque el plano para agregar un espacio de ${v.toLowerCase()}">${icon[k]}<b>${v}</b></button>`).join('')}
      <button data-accion="girar" title="Girar (R): parado o acostado">${icon.girar}<b id="rotTxt">${rotNuevo ? 'Acostado' : 'Parado'}</b></button>
    </div>`;

  function montar() {
    el.innerHTML = `
      <div class="page-head">
        <div><h1>Plano del parqueadero</h1><p>${esc(ctx.sedeNombre)}. Arrastre, dibuje y guarde. Los operadores ven los cambios apenas guarde.</p></div>
        <div class="row">
          <button class="btn" id="rehacer" title="Describa su parqueadero o use una foto para armar el plano de nuevo">${icon.magia} Rehacer con asistente</button>
          <button class="btn" id="ayuda">${icon.ayuda} Cómo usarlo</button>
          <button class="btn primary" id="guardar" ${sucio ? '' : 'disabled'}>${icon.guardar} Guardar plano</button>
        </div>
      </div>
      <div class="alert info only-touch" style="margin-bottom:14px">${icon.idea}<span>En el celular puede revisar el plano, pero dibujarlo es más cómodo en un computador o tableta.</span></div>
      <div class="pl-editor">
        <div class="card pl-herr" id="herr">${herramientas()}</div>
        <div class="card pl-lienzo">
          <div class="pl-barra">
            <span class="small muted" id="pista"></span>
            <div class="row" style="gap:6px">
              <button class="icon-btn" data-zoom="-1" aria-label="Alejar">${icon.zoomOut}</button>
              <span class="small mono" id="zoomTxt" style="min-width:42px;text-align:center"></span>
              <button class="icon-btn" data-zoom="1" aria-label="Acercar">${icon.zoomIn}</button>
            </div>
          </div>
          <div class="pl-scroll" id="lienzo"></div>
        </div>
        <div class="stack pl-lado" id="lado"></div>
      </div>`;

    el.querySelector('#ayuda').onclick = () => iniciarTour('plano', ctx);
    el.querySelector('#rehacer').onclick = () => asistente(true);
    el.querySelector('#guardar').onclick = guardar;
    el.querySelectorAll('#herr [data-h]').forEach((b) => b.onclick = () => usar(b.dataset.h));
    el.querySelector('#herr [data-accion="deshacer"]').onclick = deshacer;
    el.querySelector('#herr [data-accion="girar"]').onclick = girar;
    el.querySelectorAll('[data-zoom]').forEach((b) => b.onclick = () => {
      zoom = Math.min(2.5, Math.max(0.4, +(zoom + b.dataset.zoom * 0.2).toFixed(1)));
      pintar();
    });
    // Tamaño inicial: que el lote quepa a lo ancho del lienzo
    const lienzo = el.querySelector('#lienzo');
    const altoVisible = Math.max(320, innerHeight - lienzo.getBoundingClientRect().top - 40);
    const ajuste = Math.min((lienzo.clientWidth - 24) / (plano.ancho * 22), altoVisible / (plano.alto * 22));
    zoom = Math.min(1.6, Math.max(0.4, Math.floor(ajuste * 10) / 10));
    usar(herramienta);
    pintar();
  }

  function usar(h) {
    herramienta = h;
    if (!h.startsWith('ubicar:')) el.querySelectorAll('#herr [data-h]').forEach((b) => b.classList.toggle('on', b.dataset.h === h));
    else el.querySelectorAll('#herr [data-h]').forEach((b) => b.classList.remove('on'));
    const pistas = {
      mover: 'Arrastre un espacio o una pieza para moverlo. Toque para ver sus opciones.',
      borrar: 'Toque lo que quiera quitar. Los espacios quitados vuelven a la lista "Sin ubicar".',
      columna: 'Toque el plano para poner una columna.',
      texto: 'Toque el plano donde quiere el letrero.',
      fondo: 'Arrastre para mover la foto de calco. Esc o "Listo" para terminar.',
    };
    let pista = pistas[h];
    if (DIBUJABLES.includes(h)) pista = `${PIEZAS[h].ayuda.split('.')[0]}. Arrastre para dibujar, o toque para ponerla de ${PIEZAS[h].def.join(' x ')}.`;
    if (h.startsWith('esp:')) pista = `Toque el plano para agregar espacios de ${TIPOS[h.slice(4)].toLowerCase()}. Tecla R: girar.`;
    if (h.startsWith('ubicar:')) pista = `Toque el plano para ubicar ${buscar(h.slice(7))?.codigo}. Tecla R: girar.`;
    const p = el.querySelector('#pista');
    if (p) p.textContent = pista || '';
    const svg = el.querySelector('.plano-svg');
    if (svg) svg.dataset.herramienta = h.split(':')[0];
  }

  function girar() {
    if (sel?.tipo === 'esp') {
      const e = buscar(sel.clave);
      const nr = +e.plano_rot ? 0 : 1;
      const c = cabe(sel.clave, e.tipo_vehiculo, +e.plano_x, +e.plano_y, nr);
      if (!c.ok) return fail(`No se puede girar ${e.codigo || ''} ahí: ${c.motivo.toLowerCase()}`);
      guardarPaso();
      e.plano_rot = nr;
      return pintar();
    }
    rotNuevo = rotNuevo ? 0 : 1;
    const t = el.querySelector('#rotTxt');
    if (t) t.textContent = rotNuevo ? 'Acostado' : 'Parado';
    toast(`Los espacios nuevos se ponen ${rotNuevo ? 'acostados (horizontal)' : 'parados (vertical)'}`);
  }

  function pintar() {
    const cont = el.querySelector('#lienzo');
    if (!cont) return;
    cont.innerHTML = svgPlano(plano, todos(), { modo: 'editor', sel, zoom, fondo });
    const svg = cont.querySelector('svg');
    svg.dataset.herramienta = herramienta.split(':')[0];
    el.querySelector('#zoomTxt').textContent = `${Math.round(zoom * 100)} %`;
    // Tirador para cambiar el tamaño de la pieza seleccionada
    if (sel?.tipo === 'el') {
      const p = plano.elementos[sel.i];
      if (p && p.t !== 'columna') {
        svg.querySelector('.pl-guia').innerHTML = `<rect class="pl-tirador" data-tirador="1" x="${p.x + p.w - 0.45}" y="${p.y + p.h - 0.45}" width="0.9" height="0.9" rx="0.2"/>`;
      }
    }
    svg.addEventListener('pointerdown', abajo);
    svg.addEventListener('pointermove', mover);
    svg.addEventListener('pointerup', arriba);
    svg.addEventListener('pointerleave', () => { if (!arrastre) guia(''); });
    pintarLado();
  }

  function pintarLado() {
    const lado = el.querySelector('#lado');
    if (!lado) return;
    const pend = sinUbicar();
    let detalle = `<div class="card"><div class="card-b"><h3>Nada seleccionado</h3><p class="small muted" style="margin:6px 0 0">Con la herramienta <b>Mover</b>, toque un espacio o una pieza del plano para ver sus opciones.</p></div></div>`;
    if (sel?.tipo === 'esp') {
      const e = buscar(sel.clave);
      if (e) {
        detalle = `<div class="card"><div class="card-b stack">
          <div class="row between"><h3>${e.nuevo ? 'Espacio nuevo' : `Espacio ${esc(e.codigo)}`}</h3><span class="badge">${TIPOS[e.tipo_vehiculo]}</span></div>
          ${e.nuevo ? '<p class="small muted" style="margin:0">Recibirá su código (C-25, M-09...) al guardar.</p>' : ''}
          ${e.estado === 'ocupado' ? '<p class="small muted" style="margin:0">Está ocupado ahora mismo. Puede moverlo en el plano sin problema.</p>' : ''}
          <div class="row" style="gap:8px"><button class="btn sm" id="sGirar">${icon.girar} Girar</button>
          <button class="btn sm" id="sQuitar">${icon.borrar} ${e.nuevo ? 'Borrar' : 'Quitar del plano'}</button></div></div></div>`;
      }
    } else if (sel?.tipo === 'el') {
      const p = plano.elementos[sel.i];
      if (p) {
        detalle = `<div class="card"><div class="card-b stack">
          <div class="row between"><h3>${PIEZAS[p.t].nombre}</h3><button class="btn sm" id="pBorrar">${icon.trash} Borrar</button></div>
          ${p.t === 'texto' ? `<label class="f"><span>Texto del letrero</span><input class="input" id="pTexto" maxlength="40" value="${esc(p.texto || '')}"></label>` : ''}
          ${p.t !== 'columna' ? `<div class="row" style="gap:10px">
            <label class="f" style="flex:1"><span>Ancho</span><input class="input" type="number" id="pW" min="1" value="${p.w}"></label>
            <label class="f" style="flex:1"><span>Largo</span><input class="input" type="number" id="pH" min="1" value="${p.h}"></label></div>
            <p class="small muted" style="margin:0">También puede arrastrar la esquina amarilla.</p>` : ''}
        </div></div>`;
      }
    }
    lado.innerHTML = `${detalle}
      <div class="card"><div class="card-b stack">
        <div class="row between"><h3>Sin ubicar</h3><span class="badge ${pend.length ? 'orange' : 'green'}">${pend.length}</span></div>
        ${pend.length ? `<p class="small muted" style="margin:0">Toque un código y luego toque el plano donde está ese espacio. Mientras no los ubique, los operadores los ven en la lista.</p>
          <div class="pl-pendientes">${pend.slice(0, 120).map((e) => `<button class="btn sm ${herramienta === 'ubicar:' + e.id ? 'primary' : ''}" data-ubicar="${e.id}">${icon[e.tipo_vehiculo]}${esc(e.codigo)}</button>`).join('')}</div>
          <button class="btn sm" id="ubicarTodos">${icon.magia} Ubicar todos en lugares libres</button>`
          : '<p class="small muted" style="margin:0">Todos los espacios están en el plano.</p>'}
      </div></div>
      ${fondo ? `<div class="card"><div class="card-b stack">
        <div class="row between"><h3>Foto de calco</h3><button class="btn sm ghost" id="fQuitar">${icon.trash} Quitar</button></div>
        <label class="f"><span>Visibilidad</span><input type="range" id="fOp" min="5" max="100" value="${Math.round(fondo.op * 100)}"></label>
        <label class="f"><span>Tamaño</span><input type="range" id="fTam" min="20" max="300" value="100"></label>
        <button class="btn sm ${herramienta === 'fondo' ? 'primary' : ''}" id="fMover">${icon.moverTodo} ${herramienta === 'fondo' ? 'Listo, dejar de mover' : 'Mover la foto'}</button>
      </div></div>` : `<div class="card"><div class="card-b stack">
        <h3>Foto de calco</h3>
        <p class="small muted" style="margin:0">Ponga una foto o un boceto detrás del plano y dibuje encima.</p>
        <label class="btn sm" style="justify-content:flex-start">${icon.imagen} Adjuntar foto o boceto<input type="file" accept="image/*" id="fArchivo" hidden></label>
      </div></div>`}
      <div class="card"><div class="card-b stack">
        <h3>Tamaño del lote</h3>
        <div class="row" style="gap:10px">
          <label class="f" style="flex:1"><span>Ancho</span><input class="input" type="number" id="lAncho" min="8" max="${MAX_LADO}" value="${plano.ancho}"></label>
          <label class="f" style="flex:1"><span>Largo</span><input class="input" type="number" id="lAlto" min="8" max="${MAX_LADO}" value="${plano.alto}"></label>
        </div>
        <p class="small muted" style="margin:0">En cuadros de 1,25 m. ${plano.ancho} x ${plano.alto} cuadros son unos ${Math.round(plano.ancho * 1.25)} x ${Math.round(plano.alto * 1.25)} m.</p>
        <button class="btn sm ghost" id="borrarPlano" style="justify-content:flex-start;color:var(--danger)">${icon.trash} Borrar todo el plano</button>
      </div></div>`;

    lado.querySelector('#sGirar')?.addEventListener('click', girar);
    lado.querySelector('#sQuitar')?.addEventListener('click', () => { borrarSel(); });
    lado.querySelector('#pBorrar')?.addEventListener('click', () => { borrarSel(); });
    lado.querySelector('#pTexto')?.addEventListener('change', (ev) => { guardarPaso(); plano.elementos[sel.i].texto = ev.target.value.trim(); pintar(); });
    const tam = (k, v) => {
      const p = plano.elementos[sel.i];
      v = Math.max(1, Math.round(+v));
      if (k === 'w') v = Math.min(v, plano.ancho - p.x); else v = Math.min(v, plano.alto - p.y);
      guardarPaso(); p[k] = v; pintar();
    };
    lado.querySelector('#pW')?.addEventListener('change', (ev) => tam('w', ev.target.value));
    lado.querySelector('#pH')?.addEventListener('change', (ev) => tam('h', ev.target.value));
    lado.querySelectorAll('[data-ubicar]').forEach((b) => b.onclick = () => { usar('ubicar:' + b.dataset.ubicar); pintarLado(); });
    lado.querySelector('#ubicarTodos')?.addEventListener('click', ubicarTodos);
    lado.querySelector('#lAncho').onchange = (ev) => redimensionar(+ev.target.value, plano.alto);
    lado.querySelector('#lAlto').onchange = (ev) => redimensionar(plano.ancho, +ev.target.value);
    lado.querySelector('#borrarPlano').onclick = borrarPlano;

    // Foto de calco: los deslizadores cambian la imagen al instante, sin redibujar todo el plano
    const imagen = () => el.querySelector('.pl-fondo');
    lado.querySelector('#fArchivo')?.addEventListener('change', async (ev) => {
      try {
        fondo = encajar(await leerImagen(ev.target.files[0]), plano);
        fondoCambio = true; marcarSucio(); pintar();
        ok('Foto puesta detrás del plano. Ajuste su visibilidad y tamaño aquí a la derecha.');
      } catch (e) { fail(e); }
    });
    lado.querySelector('#fQuitar')?.addEventListener('click', () => { fondo = null; fondoCambio = true; marcarSucio(); if (herramienta === 'fondo') usar('mover'); pintar(); });
    lado.querySelector('#fMover')?.addEventListener('click', () => { usar(herramienta === 'fondo' ? 'mover' : 'fondo'); pintarLado(); });
    const fOp = lado.querySelector('#fOp');
    fOp?.addEventListener('input', () => { fondo.op = +fOp.value / 100; imagen()?.setAttribute('opacity', fondo.op); });
    fOp?.addEventListener('change', () => { fondoCambio = true; marcarSucio(); });
    const fTam = lado.querySelector('#fTam');
    if (fTam) {
      const base = { ...fondo };
      fTam.addEventListener('input', () => {
        const k = +fTam.value / 100;
        fondo.w = +(base.w * k).toFixed(2); fondo.h = +(base.h * k).toFixed(2);
        fondo.x = +(base.x + (base.w - fondo.w) / 2).toFixed(2); fondo.y = +(base.y + (base.h - fondo.h) / 2).toFixed(2);
        const i = imagen();
        if (i) { i.setAttribute('x', fondo.x); i.setAttribute('y', fondo.y); i.setAttribute('width', fondo.w); i.setAttribute('height', fondo.h); }
      });
      fTam.addEventListener('change', () => { fondoCambio = true; marcarSucio(); });
    }
  }

  function redimensionar(a, b) {
    a = Math.round(a); b = Math.round(b);
    if (!(a >= 8 && b >= 8 && a <= MAX_LADO && b <= MAX_LADO)) { fail(`El lote debe medir entre 8 y ${MAX_LADO} cuadros por lado`); return pintarLado(); }
    const fuera = todos().filter((e) => e.plano_x !== null && (() => { const [w, h] = huella(e.tipo_vehiculo, +e.plano_rot); return +e.plano_x + w > a || +e.plano_y + h > b; })());
    const piezasFuera = plano.elementos.filter((p) => p.x + p.w > a || p.y + p.h > b);
    if (fuera.length || piezasFuera.length) {
      fail(`No se puede achicar tanto: ${fuera.length ? `${fuera.length} espacio(s)` : ''}${fuera.length && piezasFuera.length ? ' y ' : ''}${piezasFuera.length ? `${piezasFuera.length} pieza(s)` : ''} quedarían por fuera. Muévalos primero.`);
      return pintarLado();
    }
    guardarPaso();
    plano.ancho = a; plano.alto = b;
    pintar();
  }

  function ubicarTodos() {
    const pend = sinUbicar();
    guardarPaso();
    let n = 0;
    for (const e of pend) {
      let rot = 0;
      let l = lugarLibre(e.tipo_vehiculo, 0);
      if (!l) { rot = 1; l = lugarLibre(e.tipo_vehiculo, 1); }
      if (!l) break;
      e.plano_x = l.x; e.plano_y = l.y; e.plano_rot = rot;
      n++;
    }
    usar('mover');
    pintar();
    if (n < pend.length) toast(`Se ubicaron ${n}. Para los otros ${pend.length - n} no hay lugar libre: agrande el lote.`);
    else ok(`Se ubicaron ${n} espacios. Muévalos a su lugar real.`);
  }

  async function borrarPlano() {
    if (!(await confirmar('Borrar todo el plano', 'Se quita el dibujo y todos los espacios quedan sin ubicar. Los operadores vuelven a ver la lista de espacios. Los espacios y su historial no se borran.', { label: 'Borrar plano', cls: 'danger' }))) return;
    try {
      await api.del(`/sedes/${sede}/plano`);
      olvidarPlano(sede);
      plano = null; nuevos = []; historial = []; sucio = false; sel = null; fondo = null; fondoCambio = false;
      espacios.forEach((e) => { e.plano_x = null; e.plano_y = null; e.plano_rot = 0; });
      ok('Plano borrado');
      asistente();
    } catch (e) { fail(e); }
  }

  function borrarSel() {
    if (!sel) return;
    guardarPaso();
    if (sel.tipo === 'el') plano.elementos.splice(sel.i, 1);
    else {
      const e = buscar(sel.clave);
      if (e?.nuevo) nuevos = nuevos.filter((n) => n !== e);
      else if (e) { e.plano_x = null; e.plano_y = null; }
    }
    sel = null;
    pintar();
  }

  // ------------------------------------------------------------ Puntero (ratón, lápiz y dedo)
  function punto(ev) {
    const svg = el.querySelector('.plano-svg');
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }
  const acotar = (v, min, max) => Math.max(min, Math.min(max, v));
  function guia(html) { const g = el.querySelector('.pl-guia'); if (g && !g.querySelector('[data-tirador]')) g.innerHTML = html; else if (g && !html) g.querySelectorAll('.pl-fantasma').forEach((n) => n.remove()); else if (g) { g.querySelectorAll('.pl-fantasma').forEach((n) => n.remove()); g.insertAdjacentHTML('beforeend', html); } }

  function abajo(ev) {
    if (ev.button !== 0) return;
    const p = punto(ev);
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    const gEsp = ev.target.closest('[data-esp]');
    const gEl = ev.target.closest('[data-el]');
    ev.currentTarget.setPointerCapture(ev.pointerId);

    if (herramienta === 'fondo') {
      if (fondo) arrastre = { tipo: 'fondo', dx: p.x - fondo.x, dy: p.y - fondo.y, movio: false };
      return;
    }

    if (herramienta === 'mover') {
      if (ev.target.closest('[data-tirador]')) {
        arrastre = { tipo: 'tamano', i: sel.i, antes: foto() };
        return;
      }
      if (gEsp) {
        const e = buscar(gEsp.dataset.esp);
        sel = { tipo: 'esp', clave: gEsp.dataset.esp };
        arrastre = { tipo: 'esp', e, dx: p.x - e.plano_x, dy: p.y - e.plano_y, x: +e.plano_x, y: +e.plano_y, nodo: null };
        pintar();
        arrastre.nodo = el.querySelector(`[data-esp="${CSS.escape(String(sel.clave))}"]`);
        return;
      }
      if (gEl) {
        const i = +gEl.dataset.el;
        const pz = plano.elementos[i];
        sel = { tipo: 'el', i };
        arrastre = { tipo: 'el', i, dx: p.x - pz.x, dy: p.y - pz.y, x: pz.x, y: pz.y, antes: foto() };
        pintar();
        return;
      }
      if (sel) { sel = null; pintar(); }
      return;
    }

    if (herramienta === 'borrar') {
      if (gEsp) { sel = { tipo: 'esp', clave: gEsp.dataset.esp }; borrarSel(); }
      else if (gEl) { sel = { tipo: 'el', i: +gEl.dataset.el }; borrarSel(); }
      return;
    }

    if (DIBUJABLES.includes(herramienta)) {
      arrastre = { tipo: 'dibujo', t: herramienta, x0: acotar(cx, 0, plano.ancho - 1), y0: acotar(cy, 0, plano.alto - 1), movio: false };
      return;
    }

    if (herramienta === 'columna') {
      if (cx < 0 || cy < 0 || cx >= plano.ancho || cy >= plano.alto) return;
      guardarPaso();
      plano.elementos.push({ t: 'columna', x: cx, y: cy, w: 1, h: 1 });
      return pintar();
    }

    if (herramienta === 'texto') {
      if (cx < 0 || cy < 0 || cx >= plano.ancho || cy >= plano.alto) return;
      modal({
        title: 'Letrero en el plano',
        body: '<label class="f"><span>Texto (por ejemplo: Sótano, Piso 2, Solo motos)</span><input class="input" name="t" maxlength="40"></label>',
        actions: [{ label: 'Cancelar' }, { label: 'Poner letrero', cls: 'primary', onClick: (c, root) => {
          const t = root.querySelector('[name=t]').value.trim();
          if (!t) return false;
          const w = Math.min(plano.ancho - cx, Math.max(2, Math.ceil(t.length * 0.6)));
          guardarPaso();
          plano.elementos.push({ t: 'texto', x: cx, y: cy, w, h: Math.min(1, plano.alto - cy), texto: t });
          pintar();
          return true;
        } }],
      });
      return;
    }

    if (herramienta.startsWith('esp:') || herramienta.startsWith('ubicar:')) {
      const ubicar = herramienta.startsWith('ubicar:') ? buscar(herramienta.slice(7)) : null;
      const tipo = ubicar ? ubicar.tipo_vehiculo : herramienta.slice(4);
      const [w, h] = huella(tipo, rotNuevo);
      const x = Math.round(p.x - w / 2), y = Math.round(p.y - h / 2);
      const c = cabe(ubicar?.id ?? null, tipo, x, y, rotNuevo);
      if (!c.ok) return fail(c.motivo);
      guardarPaso();
      if (ubicar) {
        Object.assign(ubicar, { plano_x: x, plano_y: y, plano_rot: rotNuevo });
        // Sigue con el próximo espacio del mismo tipo: ubicar 30 espacios son 30 toques
        const sig = sinUbicar().find((e) => e.tipo_vehiculo === tipo) || sinUbicar()[0];
        usar(sig ? 'ubicar:' + sig.id : 'mover');
      } else {
        nuevos.push({ tmp: 'n' + (++tmp), nuevo: true, codigo: '', tipo_vehiculo: tipo, estado: 'disponible', plano_x: x, plano_y: y, plano_rot: rotNuevo });
      }
      pintar();
    }
  }

  function mover(ev) {
    const p = punto(ev);
    if (!arrastre) {
      // Vista previa de dónde quedará el espacio nuevo
      if (herramienta.startsWith('esp:') || herramienta.startsWith('ubicar:')) {
        const tipo = herramienta.startsWith('ubicar:') ? buscar(herramienta.slice(7))?.tipo_vehiculo : herramienta.slice(4);
        if (!tipo) return;
        const [w, h] = huella(tipo, rotNuevo);
        const x = Math.round(p.x - w / 2), y = Math.round(p.y - h / 2);
        const c = cabe(null, tipo, x, y, rotNuevo);
        guia(`<rect class="pl-fantasma ${c.ok ? '' : 'mal'}" x="${x + 0.08}" y="${y + 0.08}" width="${w - 0.16}" height="${h - 0.16}" rx="0.22"/>`);
      }
      return;
    }
    if (arrastre.tipo === 'fondo') {
      fondo.x = +(p.x - arrastre.dx).toFixed(2); fondo.y = +(p.y - arrastre.dy).toFixed(2);
      arrastre.movio = true;
      const i = el.querySelector('.pl-fondo');
      if (i) { i.setAttribute('x', fondo.x); i.setAttribute('y', fondo.y); }
      return;
    }
    if (arrastre.tipo === 'esp') {
      const e = arrastre.e;
      const [w, h] = huella(e.tipo_vehiculo, +e.plano_rot);
      const nx = acotar(Math.round(p.x - arrastre.dx), 0, plano.ancho - w);
      const ny = acotar(Math.round(p.y - arrastre.dy), 0, plano.alto - h);
      arrastre.nx = nx; arrastre.ny = ny;
      if (arrastre.nodo) {
        arrastre.nodo.setAttribute('transform', `translate(${nx - arrastre.x} ${ny - arrastre.y})`);
        arrastre.nodo.classList.toggle('mal', !cabe(e.id ?? e.tmp, e.tipo_vehiculo, nx, ny, +e.plano_rot).ok);
        arrastre.nodo.classList.add('arrastrando');
      }
      return;
    }
    if (arrastre.tipo === 'el') {
      const pz = plano.elementos[arrastre.i];
      pz.x = acotar(Math.round(p.x - arrastre.dx), 0, plano.ancho - pz.w);
      pz.y = acotar(Math.round(p.y - arrastre.dy), 0, plano.alto - pz.h);
      arrastre.movio = pz.x !== arrastre.x || pz.y !== arrastre.y;
      if (arrastre.movio) pintarSoloSvg();
      return;
    }
    if (arrastre.tipo === 'tamano') {
      const pz = plano.elementos[arrastre.i];
      pz.w = acotar(Math.ceil(p.x) - pz.x, 1, plano.ancho - pz.x);
      pz.h = acotar(Math.ceil(p.y) - pz.y, 1, plano.alto - pz.y);
      arrastre.movio = true;
      pintarSoloSvg();
      return;
    }
    if (arrastre.tipo === 'dibujo') {
      const x1 = acotar(Math.floor(p.x), 0, plano.ancho - 1), y1 = acotar(Math.floor(p.y), 0, plano.alto - 1);
      const x = Math.min(arrastre.x0, x1), y = Math.min(arrastre.y0, y1);
      const w = Math.abs(x1 - arrastre.x0) + 1, h = Math.abs(y1 - arrastre.y0) + 1;
      arrastre.movio = arrastre.movio || w > 1 || h > 1;
      arrastre.r = { x, y, w, h };
      guia(`<rect class="pl-fantasma pieza pl-f-${arrastre.t}" x="${x}" y="${y}" width="${w}" height="${h}" rx="0.18"/>`);
    }
  }

  /** Durante un arrastre de pieza solo se redibuja el SVG (no el panel lateral). */
  function pintarSoloSvg() {
    const cont = el.querySelector('#lienzo');
    const scroll = [cont.scrollLeft, cont.scrollTop];
    const svg = cont.querySelector('svg');
    const nuevo = document.createElement('div');
    nuevo.innerHTML = svgPlano(plano, todos(), { modo: 'editor', sel, zoom, fondo });
    const s2 = nuevo.firstElementChild;
    svg.querySelector('.pl-piezas').replaceWith(s2.querySelector('.pl-piezas'));
    const pz = sel?.tipo === 'el' ? plano.elementos[sel.i] : null;
    const g = svg.querySelector('.pl-guia');
    g.innerHTML = pz && pz.t !== 'columna' ? `<rect class="pl-tirador" data-tirador="1" x="${pz.x + pz.w - 0.45}" y="${pz.y + pz.h - 0.45}" width="0.9" height="0.9" rx="0.2"/>` : '';
    [cont.scrollLeft, cont.scrollTop] = scroll;
  }

  function arriba() {
    const a = arrastre;
    arrastre = null;
    if (!a) return;
    if (a.tipo === 'fondo') { if (a.movio) { fondoCambio = true; marcarSucio(); } return; }
    if (a.tipo === 'esp') {
      if (a.nx === undefined || (a.nx === a.x && a.ny === a.y)) return pintar();
      const e = a.e;
      const c = cabe(e.id ?? e.tmp, e.tipo_vehiculo, a.nx, a.ny, +e.plano_rot);
      if (!c.ok) { fail(c.motivo); return pintar(); }
      guardarPaso();
      e.plano_x = a.nx; e.plano_y = a.ny;
      return pintar();
    }
    if (a.tipo === 'el' || a.tipo === 'tamano') {
      if (a.movio) { historial.push(a.antes); marcarSucio(); }
      return pintar();
    }
    if (a.tipo === 'dibujo') {
      let r = a.r;
      if (!a.movio || !r) {
        // Un solo toque: pieza del tamaño típico, centrada donde tocó
        const [w, h] = PIEZAS[a.t].def;
        r = { x: acotar(a.x0 - Math.floor(w / 2), 0, Math.max(0, plano.ancho - w)), y: acotar(a.y0 - Math.floor(h / 2), 0, Math.max(0, plano.alto - h)), w: Math.min(w, plano.ancho), h: Math.min(h, plano.alto) };
      }
      guardarPaso();
      plano.elementos.push({ t: a.t, ...r });
      pintar();
    }
  }

  // ------------------------------------------------------------ Teclado
  function teclas(ev) {
    if (!plano || !el.isConnected || ev.target.closest('input, textarea, select') || document.querySelector('.modal-bg')) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); deshacer(); return; }
    if (ev.key === 'Escape') { sel = null; usar('mover'); pintar(); return; }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { if (sel) { ev.preventDefault(); borrarSel(); } return; }
    if (ev.key.toLowerCase() === 'r' && !ev.ctrlKey) { girar(); return; }
    const flechas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
    if (flechas && sel) {
      ev.preventDefault();
      if (sel.tipo === 'esp') {
        const e = buscar(sel.clave);
        const nx = +e.plano_x + flechas[0], ny = +e.plano_y + flechas[1];
        if (!cabe(sel.clave, e.tipo_vehiculo, nx, ny, +e.plano_rot).ok) return;
        guardarPaso(); e.plano_x = nx; e.plano_y = ny;
      } else {
        const p = plano.elementos[sel.i];
        const nx = p.x + flechas[0], ny = p.y + flechas[1];
        if (nx < 0 || ny < 0 || nx + p.w > plano.ancho || ny + p.h > plano.alto) return;
        guardarPaso(); p.x = nx; p.y = ny;
      }
      pintar();
    }
  }
  document.addEventListener('keydown', teclas);

  // ------------------------------------------------------------ Guardar
  async function guardar() {
    const b = el.querySelector('#guardar');
    b.disabled = true;
    try {
      const r = await api.put(`/sedes/${sede}/plano`, {
        ancho: plano.ancho, alto: plano.alto, elementos: plano.elementos,
        espacios: espacios.map((e) => ({ id: e.id, x: e.plano_x, y: e.plano_y, rot: +e.plano_rot })),
        nuevos: nuevos.map((n) => ({ tipo: n.tipo_vehiculo, x: n.plano_x, y: n.plano_y, rot: n.plano_rot })),
        ...(fondoCambio ? { fondo: fondo ? { img: fondo.img, x: fondo.x, y: fondo.y, w: fondo.w, h: fondo.h, op: fondo.op } : null } : {}),
      });
      fondoCambio = false;
      espacios = r.espacios;
      nuevos = [];
      sucio = false;
      sel = null;
      olvidarPlano(sede);
      b.classList.remove('pendiente');
      ok(r.creados.length ? `Plano guardado. Espacios nuevos: ${r.creados.join(', ')}` : 'Plano guardado. Los operadores ya lo ven.');
      pintar();
    } catch (e) { fail(e); b.disabled = false; }
  }

  // Avisar antes de perder cambios sin guardar
  const antesDeCerrar = (ev) => { if (sucio) { ev.preventDefault(); ev.returnValue = ''; } };
  window.addEventListener('beforeunload', antesDeCerrar);
  ctx.alSalir?.(async () => !sucio || confirmar('Cambios sin guardar', 'El plano tiene cambios que no ha guardado. Si sale ahora se pierden.', { label: 'Salir sin guardar', cls: 'danger' }));

  if (plano) montar(); else asistente();

  return () => {
    document.removeEventListener('keydown', teclas);
    window.removeEventListener('beforeunload', antesDeCerrar);
  };
}
