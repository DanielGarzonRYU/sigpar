/**
 * Recorridos guiados: resaltan una parte de la pantalla y explican para qué sirve, paso a paso.
 * Se abren solos la primera vez y desde el botón de ayuda (?) de la barra superior.
 */
import { icon, esc } from './ui.js';

const esCel = () => matchMedia('(max-width: 960px)').matches;
const nav = (ruta) => (esCel() ? '#menuBtn' : `#nav a[data-route="${ruta}"]`);
const esAdmin = (ctx) => ctx.can('superadmin', 'admin');

/** Pasos de cada recorrido. sel: elemento a resaltar (sin sel = tarjeta centrada). ruta: pantalla donde está. */
const TOURS = {
  general: {
    titulo: 'Recorrido por SIGPAR',
    resumen: 'Las partes del sistema en un minuto: sede, menú, alertas y dónde pedir ayuda.',
    icono: 'tap',
    pasos: (ctx) => [
      { titulo: `Hola, ${ctx.user.nombre.split(' ')[0]}`, texto: 'En un minuto le mostramos lo más importante del sistema. Puede volver a ver esta guía cuando quiera desde el botón de ayuda, arriba a la derecha.' },
      { sel: '#sedeBox', titulo: 'Elija la sede', texto: 'Todo lo que ve (el mapa, los cobros, los reportes) es de la sede elegida aquí.' },
      // En el celular todas las secciones están dentro del mismo botón de menú: un solo paso que las nombra,
      // en vez de resaltar el mismo botón cinco veces seguidas.
      ...(esCel() ? [
        { sel: '#menuBtn', titulo: 'El menú', texto: `Aquí están todas las secciones: Entradas y salidas (registrar y cobrar), Abonados (mensualidades), ${ctx.user.rol === 'operador' ? 'Cierre de caja (lo recaudado en su turno)' : 'Reportes'}${esAdmin(ctx) ? ', Plano, Tarifas' : ''} y Cómo usar, con todas las guías.` },
      ] : [
        { sel: nav('operacion'), titulo: 'Entradas y salidas', texto: 'Aquí se registra cada vehículo que entra y se cobra cuando sale. Es la pantalla más usada del día.' },
        { sel: nav('abonados'), titulo: 'Abonados', texto: 'Clientes con mensualidad. Mientras su mensualidad esté vigente no pagan al salir.' },
        { sel: nav('reportes'), titulo: ctx.user.rol === 'operador' ? 'Cierre de caja' : 'Reportes', texto: ctx.user.rol === 'operador' ? 'Lo que recaudó en su turno, separado por efectivo, tarjeta y transferencia.' : 'Recaudo, horas de mayor demanda, cierre de caja y comparación entre sedes. Todo se exporta a Excel y PDF.' },
        ...(esAdmin(ctx) ? [
          { sel: nav('plano'), titulo: 'Plano del parqueadero', texto: 'Describa su parqueadero y el plano se arma solo. Los operadores verán los espacios libres y ocupados sobre ese plano.' },
          { sel: nav('tarifas'), titulo: 'Tarifas', texto: 'Defina cuánto se cobra: por minuto, por fracción o por hora. El cobro se calcula solo en la web y en la app.' },
        ] : []),
      ]),
      { sel: '#bellBtn', titulo: 'Mensualidades por vencer', texto: 'El número indica cuántos abonados vencen pronto. Desde aquí puede avisarles por WhatsApp.' },
      ...(esCel() ? [] : [{ sel: nav('ayuda'), titulo: 'Cómo usar', texto: 'Aquí están todas las guías y las preguntas frecuentes. Puede repetirlas cuando quiera: no cambian nada del sistema.' }]),
      { sel: '#ayudaBtn', titulo: 'Ayuda rápida', texto: 'Este botón abre la guía de la pantalla donde esté, y lleva a Cómo usar, con todas las guías y preguntas frecuentes.' },
      { titulo: 'Todo listo', texto: 'Siga con lo más importante: registrar un vehículo que entra y cobrar su salida.', siguiente: { texto: 'Ver cómo se registra un vehículo', tour: 'operacion' } },
    ],
  },
  operacion: {
    titulo: 'Entradas y salidas',
    resumen: 'Registrar el vehículo que entra, el mapa en vivo y cómo cobrar la salida.',
    icono: 'operacion',
    requiereSede: true,
    ruta: 'operacion',
    // El contador "Paso X de N" solo cuenta los pasos que están en pantalla
    filtrar: '#panel',
    pasos: () => [
      { ruta: 'operacion', sel: '#panel .tabs', titulo: 'Entrada o salida', texto: 'Elija qué va a registrar. Empezamos por la entrada.' },
      { ruta: 'operacion', sel: '#fEntrada [name=placa]', titulo: 'Escriba la placa', texto: 'Con 3 letras y 3 números es carro; si termina en letra (ABC12D) es moto. El tipo de vehículo se elige solo.' },
      { ruta: 'operacion', sel: '#espInfo', titulo: 'El espacio se asigna solo', texto: 'SIGPAR elige un espacio libre. Si prefiere uno en particular, tóquelo en el mapa (los verdes están libres).' },
      { ruta: 'operacion', sel: '#fEntrada [type=submit]', titulo: 'Registrar entrada', texto: 'Guarda la hora de llegada. Luego puede imprimir el tiquete o enviarlo al cliente.' },
      { ruta: 'operacion', sel: '#mapaCard', titulo: 'El parqueadero en vivo', texto: 'Verde es libre, rojo ocupado y naranja reservado. Toque un espacio rojo para cobrar su salida. Lo que registra el operador en la app aparece aquí en segundos.' },
      { ruta: 'operacion', sel: '#ver3d', titulo: 'Ver en 3D', texto: 'Si la sede tiene plano, este botón lo inclina en perspectiva para verlo como si estuviera encima del parqueadero. Todo sigue funcionando igual: toque un espacio rojo para cobrar.' },
      { ruta: 'operacion', sel: '#vistaMapa [data-v=vehiculos]', titulo: 'Vehículos dentro', texto: 'En el mismo recuadro, la lista de vehículos con su dueño, el tiempo que llevan y cuánto pagarían ahora. Se busca por placa o por nombre, y el botón Salida abre el cobro.' },
      { ruta: 'operacion', sel: '#panel [data-tab=salida]', titulo: 'Salida y cobro', texto: 'Escriba la placa y el sistema calcula el valor con la tarifa vigente. Elija cómo pagó el cliente y registre: el recibo sale listo para imprimir, PDF o WhatsApp.' },
    ],
  },
  plano: {
    titulo: 'Plano del parqueadero',
    resumen: 'Subir una foto o un boceto y que el plano se arme solo, o describir el parqueadero.',
    icono: 'plano',
    requiereSede: true,
    soloAdmin: true,
    ruta: 'plano',
    // Solo se muestran los pasos de lo que está en pantalla: el asistente o el editor
    filtrar: '#desc, #herr',
    pasos: () => [
      { ruta: 'plano', sel: '#fotoCard', titulo: 'Suba una foto o un boceto', texto: 'Es lo más fácil: dibuje en una hoja cada puesto como un cuadro, tómele una foto y súbala. Reconocemos los puestos y armamos el plano solos, sin acomodar nada a mano.' },
      { ruta: 'plano', sel: '#vista', titulo: 'Así quedaría', texto: 'Aquí ve el plano armado: los puestos, las vías y la entrada. Los espacios con borde punteado son nuevos y se crean al guardar.' },
      { ruta: 'plano', sel: '#guardarYa', titulo: 'Guárdelo y listo', texto: 'Con un toque queda guardado y los operadores lo ven en la web y en la app. Si quiere corregir algo, use "Ajustar a mano primero".' },
      { ruta: 'plano', sel: '#desc', titulo: '¿No tiene foto?', texto: 'Descríbalo con sus palabras: "lote de 30 x 45 metros, 40 carros y 12 motos, entrada por la izquierda". El plano se arma mientras escribe.' },
      { ruta: 'plano', sel: '#herr .pl-grupo:nth-child(2)', titulo: 'Dibuje su lote', texto: 'Vías, entrada, salida, columnas, zonas donde no se parquea. Elija una pieza y arrastre sobre el plano; un solo toque la pone de tamaño típico.' },
      { ruta: 'plano', sel: '#herr .pl-grupo:nth-child(3)', titulo: 'Agregue espacios', texto: 'Elija Carro, Moto o Bicicleta y toque el plano. Con la tecla R (o el botón Girar) quedan acostados, para espacios en paralelo a la vía.' },
      { ruta: 'plano', sel: '#herr [data-h=mover]', titulo: 'Mueva y ajuste', texto: 'Con Mover arrastre espacios y piezas. La esquina amarilla de una pieza cambia su tamaño. Las flechas del teclado mueven de a un cuadro.' },
      { ruta: 'plano', sel: '#lado', titulo: 'Espacios sin ubicar y foto de calco', texto: 'Aquí están los espacios que aún no están en el plano (toque un código y luego su lugar) y la foto de calco, con su visibilidad y tamaño.' },
      { ruta: 'plano', sel: '#rehacer', titulo: '¿Prefiere empezar de nuevo?', texto: 'El asistente vuelve a armar el plano a partir de una descripción o una foto. Puede deshacer con Ctrl+Z.' },
      { ruta: 'plano', sel: '#guardar', titulo: 'Guarde', texto: 'Los operadores ven el plano en la web y en la app apenas guarde.' },
    ],
  },
  abonados: {
    titulo: 'Abonados',
    resumen: 'Inscribir clientes con mensualidad, buscarlos y renovarlos.',
    icono: 'abonados',
    ruta: 'abonados',
    filtrar: '#tabla',
    pasos: (ctx) => [
      { ruta: 'abonados', sel: '#nuevo', titulo: 'Inscribir un abonado', texto: 'Placa, datos del cliente y periodo. Se cobra la mensualidad de la tarifa de la sede.' },
      { ruta: 'abonados', sel: '#resumen', titulo: 'Filtrar con un toque', texto: 'Cada tarjeta es un filtro: toque "Por vencer" para ver a quién avisar, o "Vencidos". Tóquela otra vez para ver todos.' },
      { ruta: 'abonados', sel: '#q', titulo: 'Buscar', texto: 'Por nombre, placa o documento.' },
      { ruta: 'abonados', sel: '#tabla', titulo: esAdmin(ctx) ? 'Renovar o editar' : 'Renovar y avisar', texto: `Cada fila tiene sus acciones: Renovar la mensualidad, WhatsApp para recordarle al cliente que vence, el reloj para ver sus pagos${esAdmin(ctx) ? ' y el lápiz para editar sus datos' : ''}.` },
    ],
  },
  movimientos: {
    titulo: 'Historial',
    resumen: 'Buscar cualquier entrada o salida, ver su recibo y exportar a Excel o PDF.',
    icono: 'historial',
    ruta: 'movimientos',
    filtrar: '#filtros',
    pasos: (ctx) => [
      { ruta: 'movimientos', sel: '#filtros', titulo: 'Busque un movimiento', texto: 'Por placa (basta con el inicio: ABC encuentra ABC123), por estado, tipo de vehículo o fechas.' },
      { ruta: 'movimientos', sel: '#tabla', titulo: 'Detalle y recibo', texto: esAdmin(ctx) ? 'Cada fila tiene el botón Recibo para reimprimirlo o enviarlo, y Anular para corregir un cobro equivocado (queda en la auditoría).' : 'Cada fila tiene el botón Recibo para reimprimirlo o enviarlo por WhatsApp.' },
      { ruta: 'movimientos', sel: '#xls', titulo: 'Exportar', texto: 'Descarga en Excel o PDF exactamente lo que está filtrado.' },
    ],
  },
  reportes: {
    titulo: 'Reportes y cierre de caja',
    resumen: 'Cuánto se recaudó, en qué horas hay más movimiento y el cierre de caja del turno.',
    icono: 'reportes',
    ruta: 'reportes',
    filtrar: '#body',
    pasos: (ctx) => [
      { ruta: 'reportes', sel: '#tabs', titulo: 'Elija el reporte', texto: 'Recaudo, horas pico, cierre de caja, comparación de sedes e indicadores.' },
      { ruta: 'reportes', sel: '#rango', titulo: 'Periodo', texto: ctx.user.rol === 'operador' ? 'Elija el día del cierre. Por defecto es hoy.' : 'Hoy, 7, 30 o 90 días, o las fechas que quiera.' },
      { ruta: 'reportes', sel: '#body', titulo: 'Resultado', texto: 'El cierre de caja separa lo recaudado en efectivo, tarjeta y transferencia, para cuadrar al final del turno.' },
      { ruta: 'reportes', sel: '#pdf', titulo: 'Imprimir o enviar', texto: 'Exporte a PDF para imprimir o a Excel para trabajar los datos.' },
    ],
  },
  tarifas: {
    titulo: 'Tarifas',
    resumen: 'Cuánto se cobra por minuto, fracción u hora, y probarlo antes de guardar.',
    icono: 'tarifas',
    soloAdmin: true,
    ruta: 'tarifas',
    filtrar: '#guardar',
    pasos: () => [
      { ruta: 'tarifas', sel: '#form', titulo: 'Una tarifa por tipo de vehículo', texto: 'Elija cómo se cobra (minuto, fracción u hora), los minutos de gracia, el tope por día y la mensualidad.' },
      { ruta: 'tarifas', sel: '#sTipo', titulo: 'Pruébela', texto: 'El simulador calcula cuánto pagaría un vehículo por un tiempo dado, con los valores que está escribiendo.' },
      { ruta: 'tarifas', sel: '#guardar', titulo: 'Guarde', texto: 'Desde ese momento la web y la app cobran con la tarifa nueva. Los vehículos que ya están dentro también.' },
    ],
  },
};

/** Todas las guías que puede ver este usuario, en orden, para la sección "Cómo usar". */
export function catalogoGuias(ctx) {
  return Object.entries(TOURS)
    .filter(([, d]) => !d.soloAdmin || esAdmin(ctx))
    .map(([id, d]) => ({ id, titulo: d.titulo, resumen: d.resumen, icono: d.icono, visto: yaVisto(id, ctx) }));
}

/** Vuelve a mostrar las guías automáticas (se abren solas otra vez la primera vez en cada pantalla). */
export function reiniciarGuias(ctx) {
  Object.keys(TOURS).forEach((id) => { try { localStorage.removeItem(clave(id, ctx)); } catch { /* sin almacenamiento */ } });
}

/** Recorridos que tienen sentido en la pantalla actual (para el menú de ayuda). */
export function toursDisponibles(ruta, ctx) {
  const l = [['general', TOURS.general.titulo]];
  if (TOURS[ruta] && ruta !== 'general' && (!TOURS[ruta].soloAdmin || esAdmin(ctx))) l.unshift([ruta, `Cómo usar ${TOURS[ruta].titulo.toLowerCase()}`]);
  if (ruta !== 'operacion') l.push(['operacion', 'Cómo registrar entradas y salidas']);
  if (ruta !== 'plano' && esAdmin(ctx)) l.push(['plano', 'Cómo dibujar el plano']);
  return l;
}

/**
 * Alto de la barra superior (lo resaltado del contenido no debe quedar debajo de ella).
 * Para lo que está en la propia barra o en el menú lateral vale 0: eso nunca se tapa.
 */
const barraArriba = (n) => (n?.closest('.topbar, .sidebar, #sidebar') ? 0 : Math.max(0, document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0));

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function encontrar(sel, ms = 2500) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const n = document.querySelector(sel);
    if (n && n.getClientRects().length) return n;
    await esperar(80);
  }
  return null;
}

let activo = null;

export async function iniciarTour(nombre, ctx) {
  const def = TOURS[nombre];
  if (!def) return;
  cerrar();
  if (def.requiereSede && !ctx.sedeId) {
    // Sin sede elegida no hay mapa ni formulario que mostrar: se elige la primera
    if (ctx.sedes.length) ctx.setSede(ctx.sedes[0].id);
    await esperar(300);
  }
  if (def.ruta && !location.hash.startsWith('#/' + def.ruta)) { ctx.go(def.ruta); await esperar(300); }
  let pasos = def.pasos(ctx);
  if (def.filtrar) {
    await encontrar(def.filtrar, 4000);
    pasos = pasos.filter((p) => !p.sel || document.querySelector(p.sel)?.getClientRects().length);
  }
  const capa = document.createElement('div');
  capa.className = 'tour';
  capa.innerHTML = `<div class="tour-foco"></div><div class="tour-globo" role="dialog" aria-live="polite"></div>`;
  document.body.appendChild(capa);
  const foco = capa.querySelector('.tour-foco');
  const globo = capa.querySelector('.tour-globo');
  let i = 0;
  let objetivo = null;

  const colocar = () => {
    const vw = innerWidth, vh = innerHeight;
    if (!objetivo) {
      foco.classList.add('centro');
      Object.assign(foco.style, { top: `${vh / 2}px`, left: `${vw / 2}px`, width: '0px', height: '0px' });
      globo.style.top = `${Math.max(16, vh / 2 - globo.offsetHeight / 2)}px`;
      globo.style.left = `${Math.max(16, vw / 2 - globo.offsetWidth / 2)}px`;
      globo.dataset.lado = 'centro';
      return;
    }
    foco.classList.remove('centro');
    const r0 = objetivo.getBoundingClientRect();
    const m = 6;
    const arriba = barraArriba(objetivo);
    const gw = globo.offsetWidth, gh = globo.offsetHeight;
    // Lo resaltado nunca pasa por debajo de la barra superior ni se sale por los lados
    let top = Math.max(r0.top, arriba + m);
    let bottom = r0.bottom;
    const left = Math.max(r0.left, 8 + m), right = Math.min(r0.right, vw - 8 - m);
    // Si la parte es más alta que el espacio libre (una lista larga en el celular), se resalta
    // solo su comienzo y el globo va justo debajo: así ni lo tapa ni el foco ocupa toda la pantalla.
    const libre = vh - arriba - gh - 14 - 16 - m * 2;
    const alta = bottom - top > libre;
    // (si ya no se puede desplazar más, por ejemplo al final de la página, se recorta hasta donde empieza el globo)
    if (alta) bottom = Math.min(bottom, top + Math.max(72, libre), Math.max(top + 72, vh - gh - 16 - 14 - m));
    Object.assign(foco.style, { top: `${top - m}px`, left: `${left - m}px`, width: `${right - left + m * 2}px`, height: `${Math.max(0, bottom - top) + m * 2}px` });
    let gTop, lado;
    let gLeft = Math.min(Math.max(16, left + (right - left) / 2 - gw / 2), vw - gw - 16);
    const alLado = (x) => { gLeft = x; gTop = Math.min(Math.max(arriba + 16, top), vh - gh - 16); };
    if (alta || bottom + m + 14 + gh <= vh - 16) { gTop = Math.min(bottom + m + 14, vh - gh - 16); lado = 'abajo'; }
    else if (top - m - 14 - gh >= arriba) { gTop = top - m - 14 - gh; lado = 'arriba'; }
    // Ni arriba ni abajo: al lado, donde haya espacio (por ejemplo, la columna de herramientas del plano)
    else if (vw - right - m - 14 >= gw + 16) { alLado(right + m + 14); lado = 'derecha'; }
    else if (left - m - 14 >= gw + 16) { alLado(left - m - 14 - gw); lado = 'izquierda'; }
    else { gTop = Math.max(16, vh - gh - 16); lado = 'abajo'; }
    globo.style.top = `${gTop}px`;
    globo.style.left = `${gLeft}px`;
    globo.dataset.lado = lado;
  };

  async function mostrar(n, dir = 1) {
    if (n < 0) return mostrar(0, 1);
    i = n;
    const p = pasos[i];
    if (!p) return cerrar(true);
    if (p.ruta && !location.hash.startsWith('#/' + p.ruta)) { ctx.go(p.ruta); await esperar(250); }
    objetivo = p.sel ? await encontrar(p.sel) : null;
    if (activo?.capa !== capa) return;              // se cerró mientras esperaba
    if (p.sel && !objetivo) return mostrar(i + dir, dir); // ese elemento no está en esta pantalla
    const ultimo = i === pasos.length - 1;
    globo.innerHTML = `
      <div class="tour-paso">${pasos.length > 1 ? `Paso ${i + 1} de ${pasos.length}` : ''}</div>
      <h3>${esc(p.titulo)}</h3>
      <p>${esc(p.texto)}</p>
      <div class="tour-puntos">${pasos.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="tour-acciones">
        <button class="btn ghost sm" data-t="saltar">${ultimo ? 'Cerrar' : 'Saltar guía'}</button>
        <span class="grow"></span>
        ${i > 0 ? '<button class="btn sm" data-t="atras">Atrás</button>' : ''}
        ${p.siguiente ? `<button class="btn primary sm" data-t="otro">${esc(p.siguiente.texto)}</button>`
          : `<button class="btn primary sm" data-t="sig">${ultimo ? 'Terminar' : 'Siguiente'}</button>`}
      </div>`;
    globo.classList.remove('entra'); void globo.offsetWidth; globo.classList.add('entra');
    if (objetivo) {
      // Si cabe con el globo, se centra; si es más alta, su comienzo queda justo bajo la barra superior
      const suave = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      const cabe = objetivo.getBoundingClientRect().height + globo.offsetHeight + 60 <= innerHeight - barraArriba(objetivo);
      objetivo.style.scrollMarginTop = `${barraArriba(objetivo) + 14}px`;
      objetivo.scrollIntoView({ block: cabe ? 'center' : 'start', behavior: suave });
    }
    // Espera a que termine el desplazamiento suave antes de medir
    colocar();
    setTimeout(colocar, 320);
    globo.querySelector('[data-t="sig"], [data-t="otro"]')?.focus({ preventScroll: true });
  }

  globo.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-t]')?.dataset.t;
    if (t === 'sig') mostrar(i + 1);
    if (t === 'atras') mostrar(i - 1, -1);
    if (t === 'saltar') cerrar(true);
    if (t === 'otro') { const sig = pasos[i].siguiente.tour; cerrar(true); iniciarTour(sig, ctx); }
  });
  const teclas = (ev) => {
    if (ev.key === 'Escape') cerrar(true);
    if (ev.key === 'ArrowRight') mostrar(i + 1);
    if (ev.key === 'ArrowLeft' && i > 0) mostrar(i - 1, -1);
  };
  const reubicar = () => colocar();
  document.addEventListener('keydown', teclas);
  addEventListener('resize', reubicar);
  addEventListener('scroll', reubicar, true);

  activo = {
    capa,
    fin: () => {
      document.removeEventListener('keydown', teclas);
      removeEventListener('resize', reubicar);
      removeEventListener('scroll', reubicar, true);
    },
    nombre,
    ctx,
  };
  mostrar(0);
}

function cerrar(visto = false) {
  if (!activo) return;
  const { capa, fin, nombre, ctx } = activo;
  activo = null;
  fin();
  if (visto) marcarVisto(nombre, ctx);
  capa.classList.add('sale');
  setTimeout(() => capa.remove(), 180);
}

const clave = (nombre, ctx) => `sigpar_guia_${nombre}_${ctx.user.id}`;
function marcarVisto(nombre, ctx) { try { localStorage.setItem(clave(nombre, ctx), '1'); } catch { /* sin almacenamiento */ } }
export function yaVisto(nombre, ctx) { try { return localStorage.getItem(clave(nombre, ctx)) === '1'; } catch { return true; } }

/** Menú del botón de ayuda. */
export function menuAyuda(boton, ruta, ctx) {
  const old = boton.parentElement.querySelector('.dropdown.ayuda');
  if (old) return old.remove();
  const dd = document.createElement('div');
  dd.className = 'dropdown ayuda';
  dd.innerHTML = `<div class="small muted" style="padding:6px 10px 4px">Guías rápidas</div>
    ${toursDisponibles(ruta, ctx).map(([k, t]) => `<button data-tour="${k}">${icon.tap} ${esc(t)}</button>`).join('')}
    <button data-ir="ayuda" class="ayuda-todas">${icon.ayuda} Ver todas las guías y preguntas</button>`;
  boton.parentElement.appendChild(dd);
  dd.onclick = (ev) => {
    ev.stopPropagation();
    const k = ev.target.closest('[data-tour]')?.dataset.tour;
    const ir = ev.target.closest('[data-ir]')?.dataset.ir;
    dd.remove();
    if (k) iniciarTour(k, ctx);
    if (ir) ctx.go(ir);
  };
  setTimeout(() => document.addEventListener('click', () => dd.remove(), { once: true }));
}
