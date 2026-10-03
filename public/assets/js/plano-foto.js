/**
 * Lector de fotos y bocetos del parqueadero, sin IA y sin Internet (todo corre en el navegador).
 *
 * Pensado para lo que un administrador puede hacer fácil: dibujar en una hoja cada puesto como un
 * cuadro o rectángulo cerrado y tomarle una foto. También sirve con fotos aéreas donde las líneas
 * pintadas cierran cada puesto.
 *
 * Pasos:
 *  1. Se reduce la imagen y se pasa a grises.
 *  2. Umbral adaptativo (compara cada píxel con el promedio de su vecindad): así las sombras y la luz
 *     desigual de una foto con celular no confunden. Si la imagen es oscura (asfalto con líneas
 *     blancas) se invierte.
 *  3. Se engrosan un poco las líneas para cerrar los huecos del lápiz.
 *  4. Se buscan las regiones cerradas (relleno por inundación). Las que parecen rectángulos son
 *     candidatos a puesto; el tamaño típico decide qué es carro, qué es moto y qué es una zona grande.
 *  5. Se pasa todo a la cuadrícula del plano (celdas de 1,25 m), se separan los puestos que queden
 *     encimados y se deducen las vías (las franjas libres entre filas) y la entrada.
 */

const CAR_ANCHO = 2; // celdas
const CAR_LARGO = 4;

/** Carga una imagen (data URL o URL de blob). */
function cargar(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('No se pudo abrir la imagen'));
    i.src = src;
  });
}

const mediana = (arr) => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/** Máscara de "tinta" (1 = línea) con umbral adaptativo por imagen integral. */
function binarizar(gris, W, H) {
  let suma = 0;
  for (let i = 0; i < gris.length; i++) suma += gris[i];
  const invertir = suma / gris.length < 110; // asfalto oscuro con líneas claras
  if (invertir) for (let i = 0; i < gris.length; i++) gris[i] = 255 - gris[i];

  const integ = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let fila = 0;
    for (let x = 0; x < W; x++) {
      fila += gris[y * W + x];
      integ[(y + 1) * (W + 1) + x + 1] = integ[y * (W + 1) + x + 1] + fila;
    }
  }
  const r = Math.max(6, Math.round(Math.min(W, H) / 22));
  const C = 14;
  const tinta = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
      const n = (x1 - x0 + 1) * (y1 - y0 + 1);
      const s = integ[(y1 + 1) * (W + 1) + x1 + 1] - integ[y0 * (W + 1) + x1 + 1] - integ[(y1 + 1) * (W + 1) + x0] + integ[y0 * (W + 1) + x0];
      if (gris[y * W + x] < s / n - C) tinta[y * W + x] = 1;
    }
  }
  return { tinta, invertida: invertir };
}

/** Engrosa las líneas (dilatación cuadrada de radio r) para cerrar huecos pequeños del trazo. */
function dilatar(m, W, H, r) {
  if (r < 1) return m;
  // Por separado en horizontal y vertical: mucho más rápido que el cuadrado completo
  const h = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let ultimo = -1e9;
    for (let x = 0; x < W; x++) { if (m[y * W + x]) ultimo = x; if (x - ultimo <= r) h[y * W + x] = 1; }
    ultimo = 1e9;
    for (let x = W - 1; x >= 0; x--) { if (m[y * W + x]) ultimo = x; if (ultimo - x <= r) h[y * W + x] = 1; }
  }
  const v = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    let ultimo = -1e9;
    for (let y = 0; y < H; y++) { if (h[y * W + x]) ultimo = y; if (y - ultimo <= r) v[y * W + x] = 1; }
    ultimo = 1e9;
    for (let y = H - 1; y >= 0; y--) { if (h[y * W + x]) ultimo = y; if (ultimo - y <= r) v[y * W + x] = 1; }
  }
  return v;
}

/** Regiones cerradas de fondo (no tinta), con su caja, área y si tocan el borde de la imagen. */
function regiones(tinta, W, H) {
  const etiqueta = new Int32Array(W * H);
  const lista = [];
  const pila = new Int32Array(W * H);
  let id = 0;
  for (let inicio = 0; inicio < W * H; inicio++) {
    if (tinta[inicio] || etiqueta[inicio]) continue;
    id++;
    let n = 0, top = 0;
    let minx = W, maxx = 0, miny = H, maxy = 0, borde = false;
    pila[top++] = inicio;
    etiqueta[inicio] = id;
    while (top) {
      const p = pila[--top];
      const x = p % W, y = (p / W) | 0;
      n++;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) borde = true;
      if (x > 0 && !tinta[p - 1] && !etiqueta[p - 1]) { etiqueta[p - 1] = id; pila[top++] = p - 1; }
      if (x < W - 1 && !tinta[p + 1] && !etiqueta[p + 1]) { etiqueta[p + 1] = id; pila[top++] = p + 1; }
      if (y > 0 && !tinta[p - W] && !etiqueta[p - W]) { etiqueta[p - W] = id; pila[top++] = p - W; }
      if (y < H - 1 && !tinta[p + W] && !etiqueta[p + W]) { etiqueta[p + W] = id; pila[top++] = p + W; }
    }
    lista.push({ area: n, x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1, borde });
  }
  return lista;
}

/**
 * Lee la imagen y propone un plano. Devuelve
 * { ok, ancho, alto, elementos, espacios:[{tipo,x,y,rot}], notas, detectados:{carro,moto,zona} }
 * u { ok:false, motivo } si no encontró puestos.
 */
export async function leerImagenPlano(src) {
  const img = await cargar(src);
  const escala = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(60, Math.round(img.naturalWidth * escala));
  const H = Math.max(60, Math.round(img.naturalHeight * escala));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  g.drawImage(img, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data;
  const gris = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) gris[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;

  const { tinta: crudo, invertida } = binarizar(gris, W, H);
  const tinta = dilatar(crudo, W, H, Math.max(1, Math.round(Math.min(W, H) / 300)));
  const regs = regiones(tinta, W, H);

  // ---------------------------------------------------------------- Clasificar regiones
  const minArea = W * H * 0.0003;
  const interiores = regs.filter((r) => !r.borde && r.area >= minArea);
  const rect = interiores.map((r) => ({ ...r, llenado: r.area / (r.w * r.h), aspecto: Math.max(r.w, r.h) / Math.min(r.w, r.h) }))
    .filter((r) => r.llenado >= 0.62);
  // Puestos: rectángulos de proporción de puesto (los cuadros también sirven: un boceto rápido)
  const forma = rect.filter((r) => r.aspecto <= 4.8);
  if (forma.length < 2) {
    return { ok: false, motivo: 'No encontramos puestos en la imagen. Dibuje cada puesto como un cuadro cerrado, con lapicero oscuro, y tome la foto de frente y con buena luz.' };
  }
  // Tamaño típico de puesto: la mediana de las áreas, sin contar las regiones muy grandes (vías o zonas)
  let tipico = mediana(forma.map((r) => r.area));
  const tipicoSinGrandes = mediana(forma.filter((r) => r.area < tipico * 3).map((r) => r.area));
  if (tipicoSinGrandes) tipico = tipicoSinGrandes;
  // Los puestos de carro de un mismo lote miden casi lo mismo; algo bastante más grande es una zona
  const carros = forma.filter((r) => r.area >= tipico * 0.55 && r.area <= tipico * 1.6);
  const motos = forma.filter((r) => r.area >= tipico * 0.1 && r.area < tipico * 0.55);
  const zonas = rect.filter((r) => r.area > tipico * 1.6);
  if (carros.length + motos.length < 2) {
    return { ok: false, motivo: 'Encontramos pocas formas parecidas a puestos. Intente con una foto más cercana y de frente, donde cada puesto sea un cuadro cerrado.' };
  }

  // ---------------------------------------------------------------- Orientación y escala
  // Cada puesto mira hacia sus vecinos de fila: si el vecino más cercano está al lado (horizontal),
  // el carro va "parado" (rot 0); si está arriba o abajo, "acostado" (rot 1).
  const puestos = [...carros.map((r) => ({ ...r, tipo: 'carro' })), ...motos.map((r) => ({ ...r, tipo: 'moto' }))];
  puestos.forEach((p) => { p.cx = p.x + p.w / 2; p.cy = p.y + p.h / 2; });
  for (const p of puestos) {
    const alargado = Math.max(p.w, p.h) / Math.min(p.w, p.h) >= 1.3;
    if (alargado) { p.rot = p.w > p.h ? 1 : 0; continue; } // la forma manda si el puesto es alargado
    // Cuadros: se cuentan los vecinos pegados a cada lado. En una fila hay vecinos a izquierda y derecha;
    // la fila de atrás (espalda con espalda) solo aporta uno, así que gana la fila. Empate: parado.
    let lado = 0, arriba = 0;
    for (const q of puestos) {
      if (q === p) continue;
      const dx = Math.abs(q.cx - p.cx), dy = Math.abs(q.cy - p.cy);
      if (dy < p.h * 0.5 && dx < p.w * 1.6) lado++;
      if (dx < p.w * 0.5 && dy < p.h * 1.6) arriba++;
    }
    p.rot = arriba > lado ? 1 : 0;
  }
  // Píxeles por celda: el ancho de un carro (su lado a lo largo de la fila) son 2 celdas
  const anchos = puestos.filter((p) => p.tipo === 'carro').map((p) => (p.rot ? p.h : p.w));
  let ppc = mediana(anchos) / CAR_ANCHO;
  if (!ppc) ppc = mediana(puestos.map((p) => Math.min(p.w, p.h)));

  // ---------------------------------------------------------------- Filas y enderezado
  // Una foto tomada con el celular casi nunca queda derecha: se agrupan los puestos en filas,
  // se mide la inclinación promedio de esas filas y se compensa antes de pasar a la cuadrícula.
  const filasDe = (lista) => {
    const grupos = [];
    for (const rot of [0, 1]) {
      const perp = rot ? 'cx' : 'cy', tam = rot ? 'w' : 'h';
      const orden = lista.filter((q) => q.rot === rot).sort((u, v) => u[perp] - v[perp]);
      const propios = [];
      for (const q of orden) {
        const g = propios[propios.length - 1];
        if (g && Math.abs(q[perp] - g.ref) < q[tam] * 0.55) { g.items.push(q); g.ref += (q[perp] - g.ref) / g.items.length; }
        else propios.push({ rot, ref: q[perp], items: [q] });
      }
      grupos.push(...propios);
    }
    return grupos;
  };
  let suma = 0, peso = 0;
  for (const f of filasDe(puestos)) {
    if (f.items.length < 3) continue;
    // Pendiente por mínimos cuadrados: fila horizontal (cy contra cx) o vertical (cx contra cy)
    const [u, v] = f.rot ? ['cy', 'cx'] : ['cx', 'cy'];
    const n = f.items.length;
    const mu = f.items.reduce((t, q) => t + q[u], 0) / n, mv = f.items.reduce((t, q) => t + q[v], 0) / n;
    let num = 0, den = 0;
    for (const q of f.items) { num += (q[u] - mu) * (q[v] - mv); den += (q[u] - mu) ** 2; }
    if (!den) continue;
    const ang = Math.atan(num / den) * (f.rot ? -1 : 1);
    if (Math.abs(ang) < 0.35) { suma += ang * n; peso += n; }
  }
  const angulo = peso ? suma / peso : 0;
  if (Math.abs(angulo) > 0.003) {
    const cos = Math.cos(-angulo), sin = Math.sin(-angulo), mx = W / 2, my = H / 2;
    const girar = (o) => { const dx = o.cx - mx, dy = o.cy - my; o.cx = mx + dx * cos - dy * sin; o.cy = my + dx * sin + dy * cos; };
    puestos.forEach(girar);
    zonas.forEach((z) => { z.cx = z.x + z.w / 2; z.cy = z.y + z.h / 2; girar(z); z.x = z.cx - z.w / 2; z.y = z.cy - z.h / 2; });
  }
  // Cada fila queda a una misma altura (o columna a un mismo ancho): nada de puestos escalonados
  const filas = filasDe(puestos);
  for (const f of filas) {
    const perp = f.rot ? 'cx' : 'cy';
    const m = mediana(f.items.map((q) => q[perp]));
    f.items.forEach((q) => { q[perp] = m; });
  }
  const ox = Math.min(...puestos.map((q) => q.cx - q.w / 2), ...zonas.map((z) => z.x));
  const oy = Math.min(...puestos.map((q) => q.cy - q.h / 2), ...zonas.map((z) => z.y));

  // ---------------------------------------------------------------- A la cuadrícula, sin encimarse
  const huella = (tipo, rot) => { const [w, h] = tipo === 'carro' ? [CAR_ANCHO, CAR_LARGO] : [1, 2]; return rot ? [h, w] : [w, h]; };
  const ocupadas = new Set();
  const libre = (x, y, w, h) => {
    if (x < 1 || y < 1) return false;
    for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) if (ocupadas.has(i + ',' + j)) return false;
    return true;
  };
  const marcar = (x, y, w, h) => { for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) ocupadas.add(i + ',' + j); };
  const espacios = [];
  // Fila por fila (de arriba a abajo, de izquierda a derecha). Los puestos que en el dibujo van pegados
  // quedan pegados en el plano: así el redondeo no deja huecos ni encima puestos vecinos.
  filas.sort((f, g) => f.ref - g.ref);
  for (const f of filas) {
    const eje = f.rot ? 'cy' : 'cx', lado = f.rot ? 'h' : 'w';
    f.items.sort((u, v) => u[eje] - v[eje]);
    let previo = null;
    for (const q of f.items) {
      const [w, h] = huella(q.tipo, q.rot);
      let bx = Math.round((q.cx - ox) / ppc - w / 2) + 1;
      let by = Math.round((q.cy - oy) / ppc - h / 2) + 1;
      if (previo) {
        const hueco = (q[eje] - q[lado] / 2) - (previo.q[eje] + previo.q[lado] / 2);
        if (hueco < q[lado] * 0.5) { if (f.rot) by = previo.y + previo.h; else bx = previo.x + previo.w; }
      }
      let puesto = null;
      // Si choca con otro, se corre en la dirección de su largo (las filas enfrentadas se separan)
      for (let k = 0; k <= 8 && !puesto; k++) {
        for (const d of k ? [k, -k] : [0]) {
          const x = q.rot ? bx + d : bx, y = q.rot ? by : by + d;
          if (libre(x, y, w, h)) { puesto = { x, y }; break; }
        }
      }
      if (!puesto) continue;
      marcar(puesto.x, puesto.y, w, h);
      espacios.push({ tipo: q.tipo, x: puesto.x, y: puesto.y, rot: q.rot });
      previo = { q, x: puesto.x, y: puesto.y, w, h };
    }
  }

  // Zonas grandes dibujadas (jardín, bodega, rampa): se pasan a la cuadrícula si no pisan puestos
  const elementos = [];
  for (const z of zonas) {
    const x = Math.round((z.x - ox) / ppc) + 1, y = Math.round((z.y - oy) / ppc) + 1;
    const w = Math.max(1, Math.round(z.w / ppc)), h = Math.max(1, Math.round(z.h / ppc));
    if (w * h > 400) continue; // demasiado grande: casi siempre es el contorno del lote
    let pisa = false;
    for (let i = x; i < x + w && !pisa; i++) for (let j = y; j < y + h; j++) if (ocupadas.has(i + ',' + j)) { pisa = true; break; }
    if (!pisa) elementos.push({ t: 'zona', x, y, w, h });
  }

  // ---------------------------------------------------------------- Tamaño del lote, vías y entrada
  const finX = Math.max(...espacios.map((e) => e.x + huella(e.tipo, e.rot)[0]), ...elementos.map((z) => z.x + z.w));
  const finY = Math.max(...espacios.map((e) => e.y + huella(e.tipo, e.rot)[1]), ...elementos.map((z) => z.y + z.h));
  let ancho = Math.min(160, Math.max(8, finX + 1));
  let alto = Math.min(160, Math.max(8, finY + 1));
  const bloqueada = (x, y) => ocupadas.has(x + ',' + y) || elementos.some((z) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h);

  // Vías: franjas horizontales o verticales del lote donde no hay nada, de al menos 2 celdas de ancho.
  // Entre dos filas de puestos enfrentadas, esa franja es el carril por donde se circula.
  const franjas = (largo, otro, vacia) => {
    const res = [];
    let ini = -1;
    for (let i = 0; i <= largo; i++) {
      const v = i < largo && vacia(i);
      if (v && ini < 0) ini = i;
      if (!v && ini >= 0) { if (i - ini >= 2 && ini > 0 && i < largo) res.push([ini, i - ini]); ini = -1; }
    }
    return res;
  };
  const filaVacia = (y) => { for (let x = 1; x < ancho - 1; x++) if (bloqueada(x, y)) return false; return true; };
  const colVacia = (x) => { for (let y = 1; y < alto - 1; y++) if (bloqueada(x, y)) return false; return true; };
  const horiz = franjas(alto, ancho, filaVacia);
  const vert = franjas(ancho, alto, colVacia);
  horiz.forEach(([y, h]) => elementos.push({ t: 'via', x: 0, y, w: ancho, h }));
  vert.forEach(([x, w]) => elementos.push({ t: 'via', x, y: 0, w, h: alto }));
  // Si no quedó ninguna vía (filas pegadas), se agrega un carril de 4 celdas abajo del lote
  if (!horiz.length && !vert.length) {
    elementos.push({ t: 'via', x: 0, y: alto - 1, w: ancho, h: 4 });
    alto = Math.min(160, alto + 4);
  }
  // Entrada y salida al comienzo de la primera vía (lado izquierdo o de arriba)
  const v0 = elementos.find((e) => e.t === 'via');
  if (v0) {
    if (v0.w >= v0.h) { const h1 = Math.ceil(v0.h / 2); elementos.push({ t: 'entrada', x: 0, y: v0.y, w: 1, h: h1 }, { t: 'salida', x: 0, y: v0.y + h1, w: 1, h: v0.h - h1 }); }
    else { const w1 = Math.ceil(v0.w / 2); elementos.push({ t: 'entrada', x: v0.x, y: 0, w: w1, h: 1 }, { t: 'salida', x: v0.x + w1, y: 0, w: v0.w - w1, h: 1 }); }
  }
  ancho = Math.max(ancho, 8);

  const det = { carro: espacios.filter((e) => e.tipo === 'carro').length, moto: espacios.filter((e) => e.tipo === 'moto').length, zona: elementos.filter((e) => e.t === 'zona').length };
  const notas = [];
  if (puestos.length - espacios.length > 0) notas.push(`${puestos.length - espacios.length} forma(s) no se pudieron ubicar sin encimarse`);
  if (invertida) notas.push('se leyó como foto con líneas claras sobre fondo oscuro');
  return { ok: true, ancho, alto, elementos, espacios, notas: notas.join('; '), detectados: det };
}
