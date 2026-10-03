/**
 * Asistente del plano: entiende una descripción en español ("lote de 30 x 45 m con 40 carros y 12 motos,
 * entrada por la izquierda") y arma un plano con vías, entrada, salida y espacios.
 *
 * Todo corre en el navegador, sin Internet ni IA. Es lógica pura (sin DOM) para poder probarla aparte.
 * Unidades: celdas de 1,25 m, igual que el editor. Carro 2 x 4 celdas, moto y bicicleta 1 x 2.
 */
import { huella } from './plano.js';

export const CELDA_M = 1.25;
export const MAX_LADO = 160;

/** Opciones por defecto del asistente. null en carros/motos/bicis = usar los espacios que ya tiene la sede. */
export const OPCIONES_BASE = {
  carros: null, motos: null, bicis: null,
  anchoM: null, largoM: null,
  forma: 'filas',          // filas | angosto | perimetro
  entrada: 'izq',          // izq | der | arriba | abajo
  salida: 'misma',         // misma | opuesta
  chicos: 'fondo',         // fondo | entrada (dónde van motos y bicicletas)
  columnas: false,
  caseta: true,
};

// ------------------------------------------------------------------ Lectura de la descripción

const UNIDADES = {
  uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
  veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27,
  veintiocho: 28, veintinueve: 29,
};
const DECENAS = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const CIENTOS = { cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500 };

/** "cuarenta y cinco carros" → "45 carros". */
function palabrasANumeros(t) {
  const tok = t.split(' ');
  const out = [];
  for (let i = 0; i < tok.length; i++) {
    let n = 0, j = i, visto = false;
    if (CIENTOS[tok[j]] !== undefined) { n += CIENTOS[tok[j]]; j++; visto = true; }
    if (DECENAS[tok[j]] !== undefined) {
      n += DECENAS[tok[j]]; j++; visto = true;
      if (tok[j] === 'y' && UNIDADES[tok[j + 1]] < 10) { n += UNIDADES[tok[j + 1]]; j += 2; }
    } else if (UNIDADES[tok[j]] !== undefined) { n += UNIDADES[tok[j]]; j++; visto = true; }
    if (visto) { out.push(String(n)); i = j - 1; } else out.push(tok[i]);
  }
  return out.join(' ');
}

export function normalizar(texto) {
  const t = String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/²/g, '2').replace(/([a-z])([,.;:()])/g, '$1 $2 ').replace(/\s+/g, ' ').trim();
  return palabrasANumeros(t);
}

const TIPO_RE = {
  carro: 'carros?|autos?|vehiculos?|coches?|camionetas?|automoviles?|particulares',
  moto: 'motos?|motocicletas?',
  bicicleta: 'bicis?|bicicletas?|ciclas?',
};
const LUGAR = '(?:puestos?|espacios?|cupos?|parqueaderos?|lugares?|plazas?|celdas?|parqueos?)';
const DIRS = [
  [/\b(izquierd[ao]|occidente|oeste)\b/, 'izq'],
  [/\b(derech[ao]|oriente|(?:el|al|del) este)\b/, 'der'],
  [/\b(arriba|norte|fondo|atras)\b/, 'arriba'],
  [/\b(abajo|sur|frente|adelante|calle|avenida)\b/, 'abajo'],
];
const OPUESTO = { izq: 'der', der: 'izq', arriba: 'abajo', abajo: 'arriba' };
export const NOMBRE_DIR = { izq: 'la izquierda', der: 'la derecha', arriba: 'arriba', abajo: 'abajo' };
const num = (s) => parseFloat(String(s).replace(',', '.'));

function direccionEn(fragmento) {
  let mejor = null;
  for (const [re, d] of DIRS) {
    const m = fragmento.match(re);
    if (m && (mejor === null || m.index < mejor.i)) mejor = { d, i: m.index };
  }
  return mejor?.d ?? null;
}

/**
 * Lee la descripción. Devuelve solo lo que encontró (para no pisar lo que el usuario ya ajustó a mano)
 * y una lista corta de lo entendido, para mostrarla.
 */
export function interpretar(texto) {
  const t = normalizar(texto);
  const c = {};
  const entendi = [];
  if (!t) return { cambios: c, entendi };

  // Cantidades
  const cuenta = (tipo) => {
    const m = t.match(new RegExp(`(\\d+)\\s*(?:${LUGAR}\\s*)?(?:(?:de|para)\\s+)?(?:${TIPO_RE[tipo]})\\b`));
    return m ? Math.min(600, parseInt(m[1], 10)) : null;
  };
  const carros = cuenta('carro'), motos = cuenta('moto'), bicis = cuenta('bicicleta');
  if (carros !== null) c.carros = carros;
  else {
    // "50 puestos" sin decir de qué: se entienden como carros
    const m = t.match(new RegExp(`(\\d+)\\s*${LUGAR}\\b(?!\\s*(?:de|para)?\\s*(?:${TIPO_RE.moto}|${TIPO_RE.bicicleta}))`));
    if (m) c.carros = Math.min(600, parseInt(m[1], 10));
  }
  if (motos !== null) c.motos = motos;
  if (bicis !== null) c.bicis = bicis;
  if (c.carros !== undefined) entendi.push(`${c.carros} carros`);
  if (c.motos !== undefined) entendi.push(`${c.motos} motos`);
  if (c.bicis !== undefined) entendi.push(`${c.bicis} bicicletas`);

  // Medidas del lote
  const U = '(?:m|mts|metros?)';
  let m = t.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${U}?\\s*(?:x|por)\\s*(\\d+(?:[.,]\\d+)?)\\s*${U}\\b`))
    || t.match(/(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)/);
  if (m) { c.anchoM = num(m[1]); c.largoM = num(m[2]); }
  const lado = (palabras) => {
    const a = t.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${U}?\\s*de\\s*(?:${palabras})\\b`))
      || t.match(new RegExp(`(?:${palabras})\\s*(?:de|es de|:)?\\s*(\\d+(?:[.,]\\d+)?)\\s*${U}?`));
    return a ? num(a[1]) : null;
  };
  if (!m) {
    const an = lado('ancho|frente'), la = lado('largo|fondo|profundidad');
    if (an) c.anchoM = an;
    if (la) c.largoM = la;
    const area = t.match(/(\d+(?:[.,]\d+)?)\s*(?:m2|mts2|metros cuadrados|m cuadrados)/);
    if (area && !an && !la) {
      // Solo el área: se supone un lote un poco más largo que ancho
      const a = num(area[1]);
      c.anchoM = Math.round(Math.sqrt(a / 1.3));
      c.largoM = Math.round(a / c.anchoM);
    }
  }
  if (c.anchoM || c.largoM) {
    c.anchoM = c.anchoM ? Math.min(200, Math.max(10, c.anchoM)) : null;
    c.largoM = c.largoM ? Math.min(200, Math.max(10, c.largoM)) : null;
    entendi.push(c.anchoM && c.largoM ? `Lote de ${c.anchoM} x ${c.largoM} m` : c.anchoM ? `${c.anchoM} m de ancho` : `${c.largoM} m de largo`);
  }

  // Forma
  if (/\b(angost|estrech|delgad|pasillo|un solo carril|una sola via|alargad)/.test(t)) c.forma = 'angosto';
  else if (/\b(alrededor|perimetro|contra (?:las |los )?(?:paredes|muros)|en (?:forma de )?u\b|rodea|por los bordes|en circulo)/.test(t)) c.forma = 'perimetro';
  else if (/\b(filas|hileras|bateria|lineas)\b/.test(t)) c.forma = 'filas';
  if (c.forma) entendi.push({ filas: 'En filas con vías', angosto: 'Lote angosto, una vía', perimetro: 'Alrededor del lote' }[c.forma]);

  // Entrada y salida
  const frag = (re) => { const f = t.match(re); return f ? f[1] : null; };
  const fe = frag(/(?:entrada|entran|se entra|ingreso|ingresan|acceso|porton|puerta)([^.;]{0,45})/);
  const fs = frag(/(?:salida|salen|se sale)([^.;]{0,45})/);
  const dEntrada = fe ? direccionEn(fe) : null;
  const dSalida = fs ? direccionEn(fs) : null;
  if (dEntrada) { c.entrada = dEntrada; entendi.push(`Entrada por ${NOMBRE_DIR[dEntrada]}`); }
  if (/(entrada y (?:la )?salida (?:por|en|a|son)|entran y salen|una sola (?:puerta|entrada)|misma (?:puerta|entrada)|mismo (?:lado|porton|acceso|sitio)|por donde entran)/.test(t)) c.salida = 'misma';
  else if (/(lado opuesto|otro lado|al contrario|salida (?:por|en|a) (?:la |el )?(?:parte de )?atras)/.test(t)) c.salida = 'opuesta';
  else if (dSalida) c.salida = dSalida === (c.entrada ?? dEntrada) ? 'misma' : 'opuesta';
  if (c.salida) entendi.push(c.salida === 'misma' ? 'Sale por la misma entrada' : 'Salida al lado opuesto');
  if (dSalida && dEntrada && dSalida !== dEntrada && dSalida !== OPUESTO[dEntrada]) entendi.push('La salida queda al frente de la entrada (ajústela después)');

  // Detalles
  if (/\bsin columnas?\b/.test(t)) c.columnas = false;
  else if (/\b(sotano|columnas?|pilares?)\b/.test(t)) { c.columnas = true; entendi.push('Con columnas'); }
  if (/\bsin (?:caseta|caja|porteria|garita)\b/.test(t)) { c.caseta = false; entendi.push('Sin caja'); }
  if (/\b(?:motos?|bicis?|bicicletas?)\b[^.;]{0,40}(?:al fondo|en el fondo|atras|al final)\b/.test(t)) { c.chicos = 'fondo'; entendi.push('Motos al fondo'); }
  else if (/\b(?:motos?|bicis?|bicicletas?)\b[^.;]{0,40}(?:junto a la entrada|cerca de la entrada|en la entrada|a la entrada|adelante|al frente|al inicio)\b/.test(t)) { c.chicos = 'entrada'; entendi.push('Motos junto a la entrada'); }

  return { cambios: c, entendi };
}

// ------------------------------------------------------------------ Generación del plano
//
// Se arma "de lado": la entrada siempre a la izquierda (x = 0). Al final se gira o se refleja para que la
// entrada quede donde dijo el administrador. Así cada forma se programa una sola vez.

/** Posiciones a lo largo de una fila; con columnas deja un hueco de 1 celda cada 3 espacios. */
function posiciones(desde, hasta, paso, conColumnas) {
  const xs = [], cols = [];
  let x = desde, n = 0;
  while (x + paso <= hasta) {
    if (conColumnas && n > 0 && n % 3 === 0) {
      if (x + 1 + paso > hasta) break;
      cols.push(x); x += 1;
    }
    xs.push(x); x += paso; n++;
  }
  return { xs, cols };
}

/** Filas de espacios enfrentadas a vías horizontales, unidas por una vía lateral a la derecha. */
function filas(W, H, pedido, op) {
  const el = [], slots = [];
  const quedan = { ...pedido };
  const chicos = () => quedan.moto + quedan.bicicleta;
  const tipoChico = () => (quedan.moto > 0 ? 'moto' : 'bicicleta');
  const vias = [];
  // ¿Hace falta más de una vía? Se prueba primero con una sola que atraviesa todo el lote.
  const capFila = (fin, paso) => posiciones(0, fin, paso, op.columnas && paso === 2).xs.length;
  const cabeEnUna = pedido.carro <= capFila(W, 2) * 2 && (chicos() === 0 || (pedido.carro === 0 && chicos() <= capFila(W, 1) * 2));
  const conectar = !cabeEnUna && H >= 16;
  const fin = conectar ? W - 4 : W;

  let y = 0;
  let casetaPuesta = !op.caseta;
  const ponerFila = (tipo, fy, alto, haciaAbajo) => {
    const paso = tipo === 'carro' ? 2 : 1;
    const { xs, cols } = posiciones(0, fin, paso, op.columnas && tipo === 'carro');
    let reservado = 0;
    if (!casetaPuesta && haciaAbajo && fy + alto >= 2) {
      // La caja va junto a la entrada, en el primer tramo de la primera fila
      el.push({ t: 'caseta', x: 0, y: fy + alto - 2, w: 3, h: 2 });
      reservado = 3;
      casetaPuesta = true;
    }
    for (const x of xs) {
      if (x < reservado) continue;
      const t = tipo === 'carro' ? 'carro' : tipoChico();
      if (quedan[t] > 0) { slots.push({ tipo: t, x, y: fy, rot: 0 }); quedan[t]--; continue; }
      // Se acabaron los carros a mitad de fila: el resto de la fila recibe motos y bicicletas, pegadas a la vía
      if (tipo !== 'carro' || chicos() <= 0) break;
      for (const dx of [0, 1]) if (chicos() > 0) { const c = tipoChico(); slots.push({ tipo: c, x: x + dx, y: haciaAbajo ? fy + 2 : fy, rot: 0 }); quedan[c]--; }
    }
    for (const cx of cols) el.push({ t: 'columna', x: cx, y: haciaAbajo ? fy + alto - 1 : fy, w: 1, h: 1 });
  };

  // Orden de los bloques: motos al frente (junto a la entrada) o al fondo
  const orden = op.chicos === 'entrada' ? ['chico', 'carro'] : ['carro', 'chico'];
  for (const clase of orden) {
    const alto = clase === 'carro' ? 4 : 2;
    const via = clase === 'carro' ? 4 : 3;
    while ((clase === 'carro' ? quedan.carro : chicos()) > 0) {
      if (y + alto + via > H) break;
      ponerFila(clase, y, alto, true);
      vias.push({ y: y + alto, h: via });
      y += alto + via;
      if ((clase === 'carro' ? quedan.carro : chicos()) > 0 && y + alto <= H) {
        ponerFila(clase, y, alto, false);
        y += alto;
      }
    }
  }

  for (const v of vias) el.push({ t: 'via', x: 0, y: v.y, w: W, h: v.h });
  if (conectar && vias.length > 1) {
    const a = vias[0].y, b = vias[vias.length - 1];
    el.push({ t: 'via', x: W - 4, y: a, w: 4, h: b.y + b.h - a });
  }
  // Entrada y salida
  if (vias.length) {
    const v0 = vias[0], vn = vias[vias.length - 1];
    if (op.salida === 'opuesta') {
      el.push({ t: 'entrada', x: 0, y: v0.y, w: 1, h: v0.h });
      el.push({ t: 'salida', x: W - 1, y: vn.y, w: 1, h: vn.h });
    } else if (vias.length > 1 && conectar) {
      el.push({ t: 'entrada', x: 0, y: v0.y, w: 1, h: v0.h });
      el.push({ t: 'salida', x: 0, y: vn.y, w: 1, h: vn.h });
    } else {
      const h1 = Math.ceil(v0.h / 2);
      el.push({ t: 'entrada', x: 0, y: v0.y, w: 1, h: h1 });
      el.push({ t: 'salida', x: 0, y: v0.y + h1, w: 1, h: v0.h - h1 });
    }
  }
  return { el, slots, usadoAlto: y };
}

/** Espacios contra los bordes del lote, vía en anillo y una isla central. */
function perimetro(W, H, pedido, op) {
  const el = [], slots = [];
  const quedan = { ...pedido };
  const tomar = (tipos, x, y, rot) => {
    for (const t of tipos) if (quedan[t] > 0) { quedan[t]--; slots.push({ tipo: t, x, y, rot }); return true; }
    return false;
  };
  const eY = 4 + Math.max(0, Math.floor((H - 8 - 4) / 4) * 2); // hueco de la entrada, a media altura
  const enHueco = (y, h, conHueco) => conHueco && y < eY + 4 && y + h > eY;
  const salidaOpuesta = op.salida === 'opuesta';

  // Anillo de circulación
  el.push({ t: 'via', x: 4, y: 4, w: W - 8, h: 4 });
  el.push({ t: 'via', x: 4, y: H - 8, w: W - 8, h: 4 });
  if (H - 16 > 0) {
    el.push({ t: 'via', x: 4, y: 8, w: 4, h: H - 16 });
    el.push({ t: 'via', x: W - 8, y: 8, w: 4, h: H - 16 });
  }
  // Entrada por la izquierda; salida por el mismo hueco o por la derecha
  el.push({ t: 'via', x: 0, y: eY, w: 4, h: 4 });
  if (salidaOpuesta) {
    el.push({ t: 'via', x: W - 4, y: eY, w: 4, h: 4 });
    el.push({ t: 'entrada', x: 0, y: eY, w: 1, h: 4 });
    el.push({ t: 'salida', x: W - 1, y: eY, w: 1, h: 4 });
  } else {
    el.push({ t: 'entrada', x: 0, y: eY, w: 1, h: 2 });
    el.push({ t: 'salida', x: 0, y: eY + 2, w: 1, h: 2 });
  }
  if (op.caseta) el.push({ t: 'caseta', x: 0, y: 0, w: 3, h: 2 });

  const carro = ['carro'], chico = ['moto', 'bicicleta'];
  // Fila de arriba y de abajo (parados), columnas izquierda y derecha (acostados)
  // Si se acaban los carros, cada lugar de borde que sobra recibe dos motos o bicicletas (del lado de la vía)
  const sobran = [];
  const borde = (x, y, rot, motos) => { if (!tomar(carro, x, y, rot)) sobran.push(motos); };
  const { xs, cols } = posiciones(4, W - 4, 2, op.columnas);
  for (const x of xs) borde(x, 0, 0, [[x, 2, 0], [x + 1, 2, 0]]);
  for (let y = 4; y + 2 <= H - 4; y += 2) if (!enHueco(y, 2, salidaOpuesta)) borde(W - 4, y, 1, [[W - 4, y, 1], [W - 4, y + 1, 1]]);
  for (const x of xs) borde(x, H - 4, 0, [[x, H - 4, 0], [x + 1, H - 4, 0]]);
  for (let y = 4; y + 2 <= H - 4; y += 2) if (!enHueco(y, 2, true)) borde(0, y, 1, [[2, y, 1], [2, y + 1, 1]]);
  if (op.columnas) for (const cx of cols) { el.push({ t: 'columna', x: cx, y: 3, w: 1, h: 1 }); el.push({ t: 'columna', x: cx, y: H - 4, w: 1, h: 1 }); }

  // Isla central: una fila mirando a cada vía; motos a los lados de la isla
  const iw = W - 16, ih = H - 16;
  if (iw >= 2 && ih >= 4) {
    const isla = posiciones(8, W - 8, 2, false).xs;
    // Si ya no quedan carros, la isla entera queda como zona sin parqueo (no un hueco vacío)
    const arriba = isla.filter((x) => tomar(carro, x, 8, 0)).length;
    const abajo = ih >= 8 ? isla.filter((x) => tomar(carro, x, H - 12, 0)).length : 0;
    const medioArriba = arriba ? 12 : 8, medioAbajo = abajo ? H - 12 : H - 8;
    if (medioAbajo - medioArriba >= 1 && iw >= 4) {
      for (let y = medioArriba; y + 1 <= medioAbajo; y++) { tomar(chico, 8, y, 1); tomar(chico, W - 10, y, 1); }
      if (iw > 4) el.push({ t: 'zona', x: 10, y: medioArriba, w: iw - 4, h: medioAbajo - medioArriba });
    } else if (medioAbajo - medioArriba >= 1 && iw >= 2) {
      el.push({ t: 'zona', x: 8, y: medioArriba, w: iw, h: medioAbajo - medioArriba });
    }
  }
  for (const par of sobran) for (const [x, y, rot] of par) tomar(chico, x, y, rot);
  return { el, slots, quedan };
}

/** Pasa del armado "de lado" (entrada a la izquierda) a la orientación pedida. */
function orientar({ W, H, el, slots }, entrada) {
  const transponer = entrada === 'arriba' || entrada === 'abajo';
  let w = W, h = H;
  let E = el.map((p) => ({ ...p }));
  let S = slots.map((s) => ({ ...s }));
  if (transponer) {
    E = E.map((p) => ({ ...p, x: p.y, y: p.x, w: p.h, h: p.w }));
    S = S.map((s) => ({ ...s, x: s.y, y: s.x, rot: s.rot ? 0 : 1 }));
    [w, h] = [H, W];
  }
  const espejoX = entrada === 'der';
  const espejoY = entrada === 'abajo';
  if (espejoX) {
    E = E.map((p) => ({ ...p, x: w - p.x - p.w }));
    S = S.map((s) => ({ ...s, x: w - s.x - huella(s.tipo, s.rot)[0] }));
  }
  if (espejoY) {
    E = E.map((p) => ({ ...p, y: h - p.y - p.h }));
    S = S.map((s) => ({ ...s, y: h - s.y - huella(s.tipo, s.rot)[1] }));
  }
  return { ancho: w, alto: h, elementos: E, slots: S };
}

const aCeldas = (m) => Math.round(m / CELDA_M);
const acotarLado = (n) => Math.max(8, Math.min(MAX_LADO, n));

/**
 * Arma el plano. existentes: cuántos espacios activos tiene hoy la sede por tipo ({carro, moto, bicicleta}).
 * Devuelve { plano, slots, faltan, pedido } donde faltan dice cuántos no cupieron en el lote indicado.
 */
export function generarPlano(opciones, existentes = {}) {
  const op = { ...OPCIONES_BASE, ...opciones };
  const pedido = {
    carro: Math.max(0, op.carros ?? existentes.carro ?? 0),
    moto: Math.max(0, op.motos ?? existentes.moto ?? 0),
    bicicleta: Math.max(0, op.bicis ?? existentes.bicicleta ?? 0),
  };
  if (!pedido.carro && !pedido.moto && !pedido.bicicleta) pedido.carro = 10;
  // En un lote angosto la vía va a lo largo: la entrada tiene que estar en uno de los lados cortos
  let entradaMovida = false;
  if (op.forma === 'angosto' && op.anchoM && op.largoM && op.anchoM !== op.largoM) {
    const alto = op.largoM > op.anchoM;
    if (alto && ['izq', 'der'].includes(op.entrada)) { op.entrada = 'abajo'; entradaMovida = true; }
    if (!alto && ['arriba', 'abajo'].includes(op.entrada)) { op.entrada = 'izq'; entradaMovida = true; }
  }
  const transponer = op.entrada === 'arriba' || op.entrada === 'abajo';
  // Medidas en la orientación "de lado": W a lo largo de las filas, H hacia el fondo
  let W = null, H = null;
  if (op.anchoM || op.largoM) {
    const a = op.anchoM ? acotarLado(aCeldas(op.anchoM)) : null;
    const l = op.largoM ? acotarLado(aCeldas(op.largoM)) : null;
    [W, H] = transponer ? [l, a] : [a, l];
  }

  // El anillo necesita un lote de al menos 18 x 16 celdas; más chico se arma en filas
  const armar = (w, h) => (op.forma === 'perimetro' && w >= 18 && h >= 16 ? perimetro(w, h, pedido, op) : filas(w, h, pedido, op));
  const cuenta = (slots) => slots.reduce((acc, s) => { acc[s.tipo]++; return acc; }, { carro: 0, moto: 0, bicicleta: 0 });
  const completo = (r) => { const c = cuenta(r.slots); return c.carro >= pedido.carro && c.moto >= pedido.moto && c.bicicleta >= pedido.bicicleta; };

  let res;
  if (W && H) {
    res = { ...armar(W, H), W, H };
  } else if (op.forma === 'perimetro') {
    // Crece de a poco hasta que caben todos (proporción parecida a un lote real)
    for (let s = 16; s <= MAX_LADO; s += 2) {
      const w = W ?? acotarLado(Math.round(s * 1.3)), h = H ?? acotarLado(s);
      res = { ...armar(w, h), W: w, H: h };
      if (completo(res)) break;
    }
  } else {
    // Filas: el ancho sale de cuántos espacios van por fila; el largo, de lo que se usó
    const chicos = pedido.moto + pedido.bicicleta;
    let w = W;
    if (!w) {
      if (op.forma === 'angosto') {
        const porFila = Math.ceil(pedido.carro / 2) || Math.ceil(chicos / 2);
        w = acotarLado((pedido.carro ? porFila * 2 : porFila) + (op.columnas ? Math.floor(porFila / 3) : 0));
      } else {
        const porFila = pedido.carro ? Math.min(20, Math.max(5, Math.ceil(Math.sqrt(pedido.carro * 1.6)))) : Math.max(6, Math.ceil(Math.sqrt(chicos * 2)));
        const base = pedido.carro ? porFila * 2 : porFila;
        w = acotarLado(base + (op.columnas ? Math.floor(porFila / 3) : 0) + 4);
      }
      // Que las motos quepan en pocas filas
      if (chicos && w < 12) w = 12;
    }
    if (H) res = { ...armar(w, H), W: w, H };
    else {
      // Largo automático: se arma sin límite y se recorta a lo que se usó
      // (con otro largo puede cambiar la distribución: se crece hasta que vuelvan a caber todos)
      let alto = acotarLado(armar(w, MAX_LADO).usadoAlto);
      res = { ...armar(w, alto), W: w, H: alto };
      while (!completo(res) && alto < MAX_LADO) { alto++; res = { ...armar(w, alto), W: w, H: alto }; }
    }
  }
  const o = orientar({ W: res.W, H: res.H, el: res.el, slots: res.slots }, op.entrada);
  const c = cuenta(o.slots);
  return {
    plano: { ancho: o.ancho, alto: o.alto, elementos: o.elementos },
    slots: o.slots,
    pedido,
    entradaMovida: entradaMovida ? op.entrada : null,
    faltan: { carro: pedido.carro - c.carro, moto: pedido.moto - c.moto, bicicleta: pedido.bicicleta - c.bicicleta },
  };
}

/**
 * Reparte los espacios que ya existen sobre los lugares del plano (por tipo y en orden de código).
 * Los lugares que sobran se vuelven espacios nuevos; los espacios que no alcanzan quedan sin ubicar.
 */
export function asignar(slots, espacios) {
  const libres = { carro: [], moto: [], bicicleta: [] };
  espacios.filter((e) => e.estado !== 'inactivo').forEach((e) => libres[e.tipo_vehiculo]?.push(e));
  const pos = new Map();
  const nuevos = [];
  for (const s of slots) {
    const e = libres[s.tipo].shift();
    if (e) pos.set(String(e.id), { x: s.x, y: s.y, rot: s.rot });
    else nuevos.push({ tipo_vehiculo: s.tipo, plano_x: s.x, plano_y: s.y, plano_rot: s.rot });
  }
  const sinUbicar = { carro: libres.carro.length, moto: libres.moto.length, bicicleta: libres.bicicleta.length };
  return { pos, nuevos, sinUbicar };
}
