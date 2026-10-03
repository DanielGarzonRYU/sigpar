/**
 * Recibo / tiquete imprimible (salida con cobro o entrada).
 */
import { api } from './api.js';
import { modal, esc, money, fechaHora, duracion, TIPOS, METODOS, icon, fail } from './ui.js';
import { linkWhatsApp } from './extras.js';

export async function mostrarRecibo(movimientoId) {
  let r;
  try { r = await api.get(`/movimientos/${movimientoId}`); } catch (e) { return fail(e); }
  const m = r.movimiento;
  const salida = m.estado === 'finalizado';
  const body = `
    <div class="receipt" id="receipt">
      <h3>${esc(r.empresa.nombre || 'SIGPAR')}</h3>
      ${r.empresa.nit ? `<div class="c">NIT ${esc(r.empresa.nit)}</div>` : ''}
      <div class="c">${esc(r.sede.nombre)}</div>
      ${r.sede.direccion ? `<div class="c">${esc(r.sede.direccion)}</div>` : ''}
      <hr>
      <div class="c"><b>${salida ? 'RECIBO DE PAGO' : m.estado === 'anulado' ? 'REGISTRO ANULADO' : 'TIQUETE DE ENTRADA'}</b></div>
      <div class="c">No. ${String(m.id).padStart(7, '0')}</div>
      <hr>
      <div class="l"><span>Placa</span><b>${esc(m.placa)}</b></div>
      <div class="l"><span>Vehículo</span><span>${TIPOS[m.tipo_vehiculo]}</span></div>
      <div class="l"><span>Espacio</span><span>${esc(m.espacio || '-')}</span></div>
      <div class="l"><span>Entrada</span><span>${fechaHora(m.entrada_at)}</span></div>
      ${salida ? `
        <div class="l"><span>Salida</span><span>${fechaHora(m.salida_at)}</span></div>
        <div class="l"><span>Tiempo</span><span>${duracion(m.minutos)}</span></div>
        ${m.abonado ? `<div class="l"><span>Abonado</span><span>${esc(m.abonado)}</span></div>` : ''}
        <hr>
        ${m.detalle_cobro ? `<div class="small">Cálculo:</div><div class="small" style="margin-bottom:6px">${esc(m.detalle_cobro)}</div>` : ''}
        <div class="l big"><span>TOTAL</span><span>${money(m.valor)}</span></div>
        <div class="l"><span>Pago</span><span>${METODOS[m.metodo_pago] || '-'}</span></div>` : ''}
      <hr>
      <div class="c small">Atendido por: ${esc((salida ? m.usuario_salida : m.usuario_entrada) || '-')}</div>
      <div class="c small">Gracias por su visita</div>
    </div>`;
  // Comprobante digital por WhatsApp (si el cliente dejó su celular)
  const texto = salida
    ? `${r.empresa.nombre || 'SIGPAR'} - ${r.sede.nombre}\nRecibo No. ${String(m.id).padStart(7, '0')}\nPlaca ${m.placa}\nEntrada: ${fechaHora(m.entrada_at)}\nSalida: ${fechaHora(m.salida_at)}\nTiempo: ${duracion(m.minutos)}\n${m.detalle_cobro ? 'Cálculo: ' + m.detalle_cobro + '\n' : ''}TOTAL: ${money(m.valor)} (${METODOS[m.metodo_pago] || ''})\nGracias por su visita.`
    : `${r.empresa.nombre || 'SIGPAR'} - ${r.sede.nombre}\nTiquete No. ${String(m.id).padStart(7, '0')}\nPlaca ${m.placa} en el espacio ${m.espacio || '-'}\nEntrada: ${fechaHora(m.entrada_at)}`;
  const wa = linkWhatsApp(m.telefono, texto);

  modal({
    title: salida ? 'Recibo de pago' : 'Tiquete de entrada',
    body,
    actions: [
      { label: 'Cerrar' },
      ...(wa ? [{ label: 'Enviar por WhatsApp', onClick: () => { window.open(wa, '_blank', 'noopener'); return false; } }] : []),
      { label: `${icon.print} Imprimir`, cls: 'primary', onClick: () => { window.print(); return false; } },
    ],
  });
}
