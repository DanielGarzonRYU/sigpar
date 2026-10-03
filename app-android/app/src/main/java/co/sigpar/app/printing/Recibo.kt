package co.sigpar.app.printing

import co.sigpar.app.data.MovimientoDetalle
import co.sigpar.app.domain.Formato
import java.text.Normalizer

/** Una línea del recibo con su estilo. */
data class Linea(val texto: String = "", val centro: Boolean = false, val negrita: Boolean = false, val grande: Boolean = false, val separador: Boolean = false)

/**
 * Contenido del recibo/tiquete, igual al de la web. De aquí salen la impresión Bluetooth (ESC/POS),
 * el PDF, el texto de WhatsApp y la vista previa, así nunca quedan distintos entre sí.
 */
object Recibo {

    fun lineas(d: MovimientoDetalle, columnas: Int = 32): List<Linea> {
        val m = d.movimiento
        val salida = m.estado == "finalizado"
        val par = { a: String, b: String -> Linea(dosColumnas(a, b, columnas)) }
        return buildList {
            add(Linea(d.empresa.nombre ?: "SIGPAR", centro = true, negrita = true))
            d.empresa.nit?.takeIf { it.isNotBlank() }?.let { add(Linea("NIT $it", centro = true)) }
            add(Linea(d.sede.nombre, centro = true))
            d.sede.direccion?.let { add(Linea(it, centro = true)) }
            add(Linea(separador = true))
            add(Linea(when { salida -> "RECIBO DE PAGO"; m.estado == "anulado" -> "REGISTRO ANULADO"; else -> "TIQUETE DE ENTRADA" }, centro = true, negrita = true))
            add(Linea("No. ${m.id.toString().padStart(7, '0')}", centro = true))
            add(Linea(separador = true))
            add(par("Placa", m.placa))
            add(par("Vehiculo", Formato.TIPOS[m.tipoVehiculo] ?: m.tipoVehiculo))
            add(par("Espacio", m.espacio ?: "-"))
            add(par("Entrada", Formato.fechaHora(m.entradaAt)))
            if (salida) {
                add(par("Salida", Formato.fechaHora(m.salidaAt)))
                add(par("Tiempo", Formato.duracion(m.minutos)))
                m.abonado?.let { add(par("Abonado", it)) }
                add(Linea(separador = true))
                m.detalleCobro?.let { add(Linea("Calculo:")); add(Linea(it)) }
                add(Linea(dosColumnas("TOTAL", Formato.dinero(m.valor), columnas / 2), negrita = true, grande = true))
                add(par("Pago", Formato.METODOS[m.metodoPago] ?: "-"))
            }
            add(Linea(separador = true))
            add(Linea("Atendido por: ${(if (salida) m.usuarioSalida else m.usuarioEntrada) ?: "-"}", centro = true))
            add(Linea(if (salida) "Gracias por su visita" else "Conserve este tiquete", centro = true))
        }
    }

    /** Texto para WhatsApp (comprobante digital). */
    fun textoWhatsApp(d: MovimientoDetalle): String {
        val m = d.movimiento
        val encabezado = "${d.empresa.nombre ?: "SIGPAR"} - ${d.sede.nombre}"
        return if (m.estado == "finalizado") buildString {
            appendLine(encabezado)
            appendLine("Recibo No. ${m.id.toString().padStart(7, '0')}")
            appendLine("Placa ${m.placa}")
            appendLine("Entrada: ${Formato.fechaHora(m.entradaAt)}")
            appendLine("Salida: ${Formato.fechaHora(m.salidaAt)}")
            appendLine("Tiempo: ${Formato.duracion(m.minutos)}")
            m.detalleCobro?.let { appendLine("Cálculo: $it") }
            appendLine("TOTAL: ${Formato.dinero(m.valor)} (${Formato.METODOS[m.metodoPago] ?: ""})")
            append("Gracias por su visita.")
        } else "$encabezado\nTiquete No. ${m.id.toString().padStart(7, '0')}\nPlaca ${m.placa} en el espacio ${m.espacio ?: "-"}\nEntrada: ${Formato.fechaHora(m.entradaAt)}"
    }

    /** "Placa ......... ABC123" ajustado al ancho del papel. */
    fun dosColumnas(a: String, b: String, columnas: Int): String {
        val espacio = columnas - a.length - b.length
        return if (espacio >= 1) a + " ".repeat(espacio) + b else "$a $b"
    }

    /** Las impresoras térmicas económicas no traen tildes: se quitan para que no salgan símbolos raros. */
    fun sinTildes(s: String): String =
        Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "")
            .replace('ñ', 'n').replace('Ñ', 'N').replace("·", "-").replace("×", "x").replace("→", "->")
            .filter { it.code in 32..126 || it == '\n' }
}
