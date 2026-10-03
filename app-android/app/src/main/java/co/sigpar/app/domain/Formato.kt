package co.sigpar.app.domain

import java.text.NumberFormat
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

/** Formatos colombianos (pesos, fechas y tiempos) iguales a los de la web. */
object Formato {
    private val es = Locale.forLanguageTag("es-CO")
    private val pesos = NumberFormat.getIntegerInstance(es)
    private val fechaHora = DateTimeFormatter.ofPattern("d MMM, h:mm a", es)
    private val soloHora = DateTimeFormatter.ofPattern("h:mm a", es)
    private val soloFecha = DateTimeFormatter.ofPattern("d MMM yyyy", es)
    private val api = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")

    fun dinero(v: Double?): String = "$ " + pesos.format((v ?: 0.0).roundToInt())

    fun duracion(minutos: Int?): String {
        val m = (minutos ?: 0).coerceAtLeast(0)
        val d = m / 1440; val h = (m % 1440) / 60; val r = m % 60
        return when {
            d > 0 -> "${d}d ${h}h ${r}m"
            h > 0 -> "${h}h ${"%02d".format(r)}m"
            else -> "$r min"
        }
    }

    fun fechaHoraApi(s: String?): LocalDateTime? = s?.let { runCatching { LocalDateTime.parse(it.take(19), api) }.getOrNull() }

    fun fechaHora(s: String?): String = fechaHoraApi(s)?.format(fechaHora) ?: "Sin fecha"
    fun hora(s: String?): String = fechaHoraApi(s)?.format(soloHora) ?: "Sin hora"
    fun fecha(s: String?): String = s?.let { runCatching { LocalDate.parse(it.take(10)).format(soloFecha) }.getOrNull() } ?: "Sin fecha"

    /** Minutos transcurridos desde [entrada] según la hora del SERVIDOR (no la del celular, que puede estar mal). */
    fun minutosDesde(entrada: String?, ahoraServidor: LocalDateTime): Int {
        val e = fechaHoraApi(entrada) ?: return 0
        return java.time.Duration.between(e, ahoraServidor).toMinutes().toInt().coerceAtLeast(0)
    }

    val TIPOS = linkedMapOf("carro" to "Carro", "moto" to "Moto", "bicicleta" to "Bicicleta")
    val METODOS = linkedMapOf("efectivo" to "Efectivo", "tarjeta" to "Tarjeta", "transferencia" to "Transferencia", "app" to "App / QR", "abonado" to "Abonado")
    val ROLES = mapOf("superadmin" to "Superadministrador", "admin" to "Administrador", "operador" to "Operador")

    /** Número colombiano → formato internacional para WhatsApp (3001234567 → 573001234567). */
    fun numeroWhatsApp(tel: String?): String? {
        val d = tel.orEmpty().filter { it.isDigit() }
        return when {
            d.length == 10 && d.startsWith("3") -> "57$d"
            d.length == 12 && d.startsWith("57") -> d
            else -> null
        }
    }
}
