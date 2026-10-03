/**
 * Plano del parqueadero: dibujo compartido por el editor (Administración > Plano) y la operación en vivo.
 *
 * Todo se mide en celdas de una cuadrícula (1 celda ≈ 1,25 m); el SVG usa esas mismas unidades
 * en su viewBox, así el dibujo escala a cualquier pantalla sin recalcular nada.
 */
import { api } from './api.js';
import { esc, duracion, minutosDesde } from './ui.js';

/** Huella de cada espacio [ancho, largo] en celdas. La misma tabla está en el servidor (Parking::PLANO_HUELLA). */
export const HUELLA = { carro: [2, 4], moto: [1, 2], bicicleta: [1, 2] };
export const huella = (tipo, rot) => { const [w, h] = HUELLA[tipo] || HUELLA.carro; return rot ? [h, w] : [w, h]; };

/** Piezas que se pueden dibujar. def = tamaño al hacer un solo clic. */
export const PIEZAS = {
  via:     { nombre: 'Vía', ayuda: 'Carril por donde circulan los vehículos. Arrastre para dibujarla.', icono: 'via', def: [8, 4] },
  entrada: { nombre: 'Entrada', ayuda: 'Por dónde entran los vehículos.', icono: 'puerta', def: [2, 4] },
  salida:  { nombre: 'Salida', ayuda: 'Por dónde salen los vehículos.', icono: 'flecha', def: [2, 4] },
  zona:    { nombre: 'Sin parqueo', ayuda: 'Jardín, bodega, rampa o cualquier área donde no se parquea.', icono: 'arbol', def: [4, 4] },
  muro:    { nombre: 'Muro', ayuda: 'Paredes y límites. Arrastre para dibujar una línea gruesa.', icono: 'muro', def: [6, 1] },
  columna: { nombre: 'Columna', ayuda: 'Columnas o postes que estorban.', icono: 'columna', def: [1, 1] },
  caseta:  { nombre: 'Caja', ayuda: 'Caseta o punto de pago.', icono: 'caseta', def: [3, 2] },
  texto:   { nombre: 'Texto', ayuda: 'Un letrero: "Sótano", "Piso 2", "Solo motos"...', icono: 'texto', def: [4, 1] },
};

const ETIQUETA = { entrada: 'Entrada', salida: 'Salida', caseta: 'Caja', zona: 'Sin parqueo' };

/** Texto centrado en un rectángulo; si el rectángulo es angosto y alto, el texto va de lado. */
function rotulo(x, y, w, h, texto, clase, max = 0.7) {
  const girar = w < h && w < 2;
  const largo = girar ? h : w;
  const ancho = girar ? w : h;
  const fs = Math.max(0.28, Math.min(max, (largo * 0.78) / Math.max(1, texto.length * 0.62), ancho * 0.55));
  const cx = x + w / 2, cy = y + h / 2;
  return `<text class="${clase}" x="${cx}" y="${cy}" font-size="${fs.toFixed(2)}" text-anchor="middle" dominant-baseline="central"${girar ? ` transform="rotate(-90 ${cx} ${cy})"` : ''}>${esc(texto)}</text>`;
}

function pieza(el, i, { sel } = {}) {
  const { t, x, y, w, h } = el;
  const s = sel?.tipo === 'el' && sel.i === i ? ' sel' : '';
  let dentro = '';
  if (t === 'via') {
    // Línea amarilla discontinua por el centro, en el sentido largo de la vía
    dentro = w >= h
      ? `<line class="pl-via-linea" x1="${x + 0.5}" y1="${y + h / 2}" x2="${x + w - 0.5}" y2="${y + h / 2}"/>`
      : `<line class="pl-via-linea" x1="${x + w / 2}" y1="${y + 0.5}" x2="${x + w / 2}" y2="${y + h - 0.5}"/>`;
  } else if (t === 'texto') {
    return `<g class="pl-el pl-texto${s}" data-el="${i}"><rect class="pl-hit" x="${x}" y="${y}" width="${w}" height="${h}"/>${rotulo(x, y, w, h, el.texto || 'Texto', 'pl-texto-t', 0.8)}</g>`;
  } else if (ETIQUETA[t]) {
    dentro = rotulo(x, y, w, h, ETIQUETA[t], `pl-rot pl-rot-${t}`, 0.62);
  }
  return `<g class="pl-el pl-${t}${s}" data-el="${i}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${t === 'columna' ? 0.1 : 0.18}"/>${dentro}</g>`;
}

/**
 * Devuelve el SVG del plano.
 * opciones.modo: 'editor' (cuadrícula, espacios neutros) o 'vivo' (colores de estado, placa y tiempo).
 */
export function svgPlano(plano, espacios, opciones = {}) {
  const { modo = 'vivo', sel = null, elegido = null, ahora = Date.now(), cambios = new Set(), zoom = 1, celda = 22, fondo = null, ajustar = false } = opciones;
  const { ancho, alto } = plano;
  const editor = modo === 'editor';
  const grid = editor ? `<pattern id="plRejilla" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" class="pl-rejilla"/></pattern>
    <pattern id="plRejilla4" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M4 0H0V4" class="pl-rejilla4"/></pattern>` : '';
  const trama = '<pattern id="plTrama" width="0.6" height="0.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="0.6" class="pl-trama"/></pattern>';

  const orden = ['zona', 'via', 'muro', 'columna', 'caseta', 'entrada', 'salida', 'texto'];
  const piezas = (plano.elementos || []).map((el, i) => [el, i]).sort((a, b) => orden.indexOf(a[0].t) - orden.indexOf(b[0].t))
    .map(([el, i]) => pieza(el, i, { sel })).join('');

  const esp = espacios.filter((e) => e.plano_x !== null && e.plano_x !== undefined && (editor || e.estado !== 'inactivo')).map((e) => {
    const [w, h] = huella(e.tipo_vehiculo, +e.plano_rot);
    const x = +e.plano_x, y = +e.plano_y;
    const clave = e.id ?? e.tmp;
    const clases = ['pl-esp', `tipo-${e.tipo_vehiculo}`];
    if (!editor) clases.push(`est-${e.estado}`);
    if (editor && e.nuevo) clases.push('nuevo');
    if (sel?.tipo === 'esp' && sel.clave === clave) clases.push('sel');
    if (elegido && elegido === e.id) clases.push('elegido');
    if (cambios.has(e.id)) clases.push('cambio');
    const ocupado = !editor && e.estado === 'ocupado';
    let textos;
    if (ocupado && Math.max(w, h) >= 4) {
      // Carro ocupado: código arriba, placa y tiempo debajo
      const girar = w > h;
      textos = girar
        ? rotulo(x, y, w * 0.34, h, e.codigo, 'pl-cod', 0.5) + rotulo(x + w * 0.3, y, w * 0.7, h * 0.55, e.placa || '', 'pl-placa', 0.55)
          + rotulo(x + w * 0.3, y + h * 0.5, w * 0.7, h * 0.45, duracion(minutosDesde(e.entrada_at, ahora)), 'pl-tiempo', 0.4)
        : rotulo(x, y + 0.1, w, h * 0.3, e.codigo, 'pl-cod', 0.5) + rotulo(x, y + h * 0.33, w, h * 0.34, e.placa || '', 'pl-placa', 0.5)
          + rotulo(x, y + h * 0.66, w, h * 0.3, duracion(minutosDesde(e.entrada_at, ahora)), 'pl-tiempo', 0.36);
    } else if (ocupado) {
      textos = rotulo(x, y, w, h, e.placa || e.codigo, 'pl-placa', 0.45);
    } else {
      textos = rotulo(x, y, w, h, e.codigo || 'Nuevo', 'pl-cod', 0.55);
    }
    const titulo = editor ? '' : `<title>${esc(e.codigo)}: ${e.estado === 'ocupado' ? `ocupado por ${esc(e.placa)}` : e.estado}</title>`;
    return `<g class="${clases.join(' ')}" data-esp="${esc(clave)}">${titulo}<rect x="${x + 0.08}" y="${y + 0.08}" width="${w - 0.16}" height="${h - 0.16}" rx="0.22"/>${textos}</g>`;
  }).join('');

  // ajustar: el SVG ocupa el ancho de su contenedor (vista previa del asistente)
  const px = editor && !ajustar ? ` width="${ancho * celda * zoom}" height="${alto * celda * zoom}"` : '';
  // Foto o boceto de calco, debajo de la cuadrícula
  const calco = fondo?.url && fondo.op > 0
    ? `<image class="pl-fondo" href="${esc(fondo.url)}" x="${fondo.x}" y="${fondo.y}" width="${fondo.w}" height="${fondo.h}" opacity="${fondo.op}" preserveAspectRatio="none"/>` : '';
  const minAncho = editor ? '' : ` style="min-width:${Math.min(ancho * 13, 2200)}px"`;
  return `<svg class="plano-svg ${editor ? 'editor' : 'vivo'}${ajustar ? ' ajustar' : ''}" viewBox="-0.5 -0.5 ${ancho + 1} ${alto + 1}"${px}${ajustar ? '' : minAncho} role="img" aria-label="Plano del parqueadero">
    <defs>${grid}${trama}<clipPath id="plRecorte"><rect x="0" y="0" width="${ancho}" height="${alto}" rx="0.3"/></clipPath></defs>
    <rect class="pl-lote" x="0" y="0" width="${ancho}" height="${alto}" rx="0.3"/>
    ${calco ? `<g clip-path="url(#plRecorte)">${calco}</g>` : ''}
    ${editor ? `<rect x="0" y="0" width="${ancho}" height="${alto}" fill="url(#plRejilla)"/><rect x="0" y="0" width="${ancho}" height="${alto}" fill="url(#plRejilla4)"/>` : ''}
    <g class="pl-piezas">${piezas}</g><g class="pl-espacios">${esp}</g><g class="pl-guia"></g>
  </svg>`;
}

/** Plano de una sede con caché por versión: solo se descarga de nuevo cuando el administrador lo cambia. */
const cache = new Map();
export async function planoDeSede(sedeId, version) {
  const c = cache.get(String(sedeId));
  if (c && c.version === version) return c.plano;
  const r = await api.get(`/sedes/${sedeId}/plano`);
  cache.set(String(sedeId), { version: r.plano_at, plano: r.plano });
  return r.plano;
}
export const olvidarPlano = (sedeId) => cache.delete(String(sedeId));
