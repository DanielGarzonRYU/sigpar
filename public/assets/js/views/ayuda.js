/**
 * Cómo usar: todas las guías paso a paso y las preguntas frecuentes, siempre a mano.
 *
 * Las guías se abren solas la primera vez; aquí se pueden repetir cuantas veces se quiera
 * (no cambian nada del sistema) o volver a activarlas para que salgan solas otra vez.
 */
import { esc, icon, ok } from '../ui.js';
import { catalogoGuias, iniciarTour, reiniciarGuias } from '../tour.js';

/** Preguntas frecuentes. guia: la guía que muestra cómo hacerlo. roles: solo para esos roles. */
const PREGUNTAS = [
  { p: '¿Cómo registro un vehículo que entra?', r: 'En Entradas y salidas escriba la placa. El tipo de vehículo (carro, moto, bicicleta) y el espacio se eligen solos; si prefiere otro espacio, tóquelo en el mapa. Luego toque Registrar entrada.', guia: 'operacion' },
  { p: '¿Cómo cobro la salida?', r: 'En Entradas y salidas elija Salida y escriba la placa, o toque el espacio rojo en el mapa. El valor se calcula solo con la tarifa de la sede. Elija cómo pagó el cliente y registre la salida.', guia: 'operacion' },
  { p: '¿Cómo imprimo o envío el recibo?', r: 'Al registrar la salida aparece el recibo listo para imprimir, descargar en PDF o enviar por WhatsApp. También puede reimprimirlo desde el Historial, con el botón Recibo de cada movimiento.' },
  { p: 'Un cliente con mensualidad, ¿paga al salir?', r: 'No. Si la placa pertenece a un abonado vigente de esa sede, la salida vale $0 y el recibo lo indica.', guia: 'abonados' },
  { p: '¿Cómo inscribo o renuevo un abonado?', r: 'En Abonados toque Nuevo abonado, escriba la placa, los datos del cliente y los meses. Para renovar, busque al cliente y use Renovar en su fila.', guia: 'abonados' },
  { p: '¿Qué pasa si se va el internet?', r: 'Arriba aparece un aviso de conexión. Espere a que vuelva antes de registrar: así ningún cobro queda a medias. Lo que ya se registró queda guardado.' },
  { p: '¿Dónde veo cuánto recaudé en mi turno?', r: 'En Reportes, pestaña Cierre de caja (para el operador se llama así en el menú). Separa efectivo, tarjeta y transferencia.', guia: 'reportes' },
  { p: '¿Cómo encuentro un vehículo que ya salió?', r: 'En Historial escriba la placa (basta con las primeras letras) y, si quiere, un rango de fechas.', guia: 'movimientos' },
  { p: '¿Lo que hace la app se ve en la web?', r: 'Sí. La web y la app usan el mismo sistema: una entrada registrada en el celular aparece en la web en pocos segundos, y al revés.' },
  { p: '¿Cómo cambio lo que se cobra?', r: 'En Tarifas elija el modo de cobro de cada tipo de vehículo, los minutos de gracia y el tope por día. Pruebe con el simulador antes de guardar.', guia: 'tarifas', roles: ['superadmin', 'admin'] },
  { p: '¿Cómo armo el plano de mi parqueadero?', r: 'En Plano suba una foto o un boceto: dibuje en una hoja cada puesto como un cuadro cerrado, tómele una foto y súbala. El plano se arma solo y lo guarda con un toque. Si no tiene foto, descríbalo con sus palabras (medidas, cuántos carros y motos, dónde está la entrada).', guia: 'plano', roles: ['superadmin', 'admin'] },
  { p: 'Me equivoqué en un cobro, ¿cómo lo corrijo?', r: 'Un administrador puede anularlo desde el Historial, con el botón Anular de ese movimiento e indicando el motivo. La anulación queda registrada en la Auditoría.', roles: ['superadmin', 'admin'] },
  { p: '¿Cómo creo un usuario para un operador?', r: 'En Usuarios toque Nuevo usuario, elija el rol Operador y la sede donde trabaja. Con ese correo y clave entra a la web y a la app.', roles: ['superadmin', 'admin'] },
  { p: '¿Cómo cambio mi contraseña?', r: 'Toque su nombre, arriba a la derecha, y elija Cambiar contraseña.' },
  { p: '¿Cómo pongo mi foto o cambio mi nombre?', r: 'Toque su nombre, arriba a la derecha, y elija Mi perfil. Ahí sube una foto y corrige su nombre. En la app está en Más, Mi cuenta, Editar nombre y foto.' },
  { p: '¿Cómo elimino un usuario?', r: 'En Usuarios, toque el ícono de la papelera en su fila. Sus entradas, salidas y cobros pasados se conservan. Si solo quiere impedir que entre por un tiempo, use Desactivar.', roles: ['superadmin', 'admin'] },
  { p: '¿Por qué la pantalla se actualiza sola?', r: 'Cuando alguien registra una entrada, una salida o un pago (en la web o en la app), las pantallas abiertas se actualizan en pocos segundos: el historial, la caja, los espacios y el dashboard muestran siempre lo último.' },
];

/** Palabras sin tildes y en minúscula, para que "credito" encuentre "crédito". */
const plano = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export default function (el, ctx) {
  const preguntas = PREGUNTAS.filter((q) => !q.roles || q.roles.includes(ctx.user.rol));

  function pintar() {
    const guias = catalogoGuias(ctx);
    const vistas = guias.filter((g) => g.visto).length;
    const [primera, ...resto] = guias;
    const tarjeta = (g) => `
      <article class="card guia" data-buscar="${esc(plano(g.titulo + ' ' + g.resumen))}">
        <div class="guia-cab">
          <span class="guia-ic">${icon[g.icono] || icon.tap}</span>
          <span class="badge ${g.visto ? 'green' : 'blue'}">${g.visto ? `${icon.listo} Vista` : 'Nueva'}</span>
        </div>
        <h3>${esc(g.titulo)}</h3>
        <p class="small muted">${esc(g.resumen)}</p>
        <button class="btn sm ${g.visto ? '' : 'primary'}" data-guia="${g.id}">${g.visto ? 'Repetir la guía' : 'Ver la guía'}</button>
      </article>`;

    el.innerHTML = `
      <div class="page-head">
        <div><h1>Cómo usar SIGPAR</h1>
          <p>Guías paso a paso que resaltan cada parte de la pantalla, y respuestas a las dudas más comunes. Repítalas cuando quiera: no cambian nada del sistema.</p></div>
      </div>

      <section class="card ayuda-inicio" data-buscar="${esc(plano(primera.titulo + ' ' + primera.resumen))}">
        <div class="ayuda-inicio-txt">
          <span class="small muted">Empiece aquí</span>
          <h2>${esc(primera.titulo)}</h2>
          <p class="muted">${esc(primera.resumen)}</p>
          <div class="row" style="gap:10px">
            <button class="btn primary" data-guia="${primera.id}">${icon.tap} ${primera.visto ? 'Repetir el recorrido' : 'Empezar el recorrido'}</button>
            <span class="small muted mono">${vistas} de ${guias.length} guías vistas</span>
          </div>
        </div>
        <div class="ayuda-progreso" aria-hidden="true">${guias.map((g) => `<i class="${g.visto ? 'on' : ''}"></i>`).join('')}</div>
      </section>

      <label class="ayuda-buscar">
        ${icon.search}
        <input class="input" type="search" id="buscar" placeholder="Buscar: cobrar, recibo, abonado, plano, contraseña..." autocomplete="off">
      </label>

      <h2 class="ayuda-titulo">Guías por pantalla</h2>
      <div class="ayuda-guias">${resto.map(tarjeta).join('')}</div>

      <h2 class="ayuda-titulo">Preguntas frecuentes</h2>
      <div class="card ayuda-faq">
        ${preguntas.map((q) => `
          <details data-buscar="${esc(plano(q.p + ' ' + q.r))}">
            <summary>${esc(q.p)}<span class="ayuda-flecha">${icon.plus}</span></summary>
            <div class="ayuda-resp">
              <p>${esc(q.r)}</p>
              ${q.guia ? `<button class="link" data-guia="${q.guia}">Mostrarme cómo, paso a paso</button>` : ''}
            </div>
          </details>`).join('')}
        <p class="small muted ayuda-nada" hidden>No encontramos nada con esas palabras. Pruebe con otra, por ejemplo "salida" o "tarifa".</p>
      </div>

      <div class="grid g2 ayuda-pie">
        <div class="card"><div class="card-b stack">
          <h3>Que las guías salgan solas otra vez</h3>
          <p class="small muted" style="margin:0">Útil para un operador nuevo en este mismo usuario, o si quiere repasar: cada guía vuelve a abrirse sola la primera vez que entre a su pantalla.</p>
          <button class="btn sm" id="reiniciar" style="align-self:flex-start">${icon.undo} Volver a mostrarlas</button>
        </div></div>
        <div class="card"><div class="card-b stack">
          <h3>En la app del celular</h3>
          <p class="small muted" style="margin:0">La app tiene su propia guía, con las mismas acciones: entrar, cobrar, recibo y qué hacer sin señal. Está en <b>Más</b>, sección <b>Cómo usar</b>.</p>
        </div></div>
      </div>`;

    el.querySelectorAll('[data-guia]').forEach((b) => b.onclick = () => iniciarTour(b.dataset.guia, ctx));
    el.querySelector('#reiniciar').onclick = () => {
      reiniciarGuias(ctx);
      ok('Listo. Las guías se abrirán solas otra vez en cada pantalla.');
      pintar();
    };
    const buscar = el.querySelector('#buscar');
    buscar.oninput = () => {
      const q = plano(buscar.value.trim());
      let visibles = 0;
      el.querySelectorAll('[data-buscar]').forEach((n) => {
        const si = !q || n.dataset.buscar.includes(q);
        n.hidden = !si;
        if (n.tagName === 'DETAILS') { if (si) visibles++; n.open = !!q && si && q.length > 2; }
      });
      el.querySelector('.ayuda-nada').hidden = visibles > 0;
    };
  }

  pintar();
}
