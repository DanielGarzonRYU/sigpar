package co.sigpar.app

import co.sigpar.app.data.EmpresaInfo
import co.sigpar.app.data.Movimiento
import co.sigpar.app.data.MovimientoDetalle
import co.sigpar.app.data.SedeInfo
import co.sigpar.app.domain.Formato
import co.sigpar.app.printing.EscPos
import co.sigpar.app.printing.Recibo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReciboTest {
    private val detalle = MovimientoDetalle(
        movimiento = Movimiento(
            id = 682, sedeId = 2, placa = "MPP994", tipoVehiculo = "carro", entradaAt = "2026-09-28 13:44:00",
            salidaAt = "2026-09-28 18:26:00", minutos = 282, valor = 14100.0, detalleCobro = "282 min × $50 = $14.100",
            metodoPago = "efectivo", estado = "finalizado", espacio = "C-12", usuarioSalida = "Andrea Pérez",
        ),
        sede = SedeInfo("Sede Norte", "Cl. 140 # 15-20, Bogotá"),
        empresa = EmpresaInfo("SIGPAR Parqueaderos"),
    )

    @Test fun reciboDePagoTieneLosDatosDelCobro() {
        val texto = Recibo.lineas(detalle, 32).joinToString("\n") { it.texto }
        assertTrue(texto.contains("RECIBO DE PAGO"))
        assertTrue(texto.contains("No. 0000682"))
        assertTrue(texto.contains("MPP994"))
        assertTrue(texto.contains("282 min × $50 = $14.100"))
        assertTrue(texto.contains(Formato.dinero(14100.0)))
    }

    @Test fun lineasNoPasanElAnchoDelPapel() {
        Recibo.lineas(detalle, 32).filter { !it.separador && !it.grande }.forEach { l ->
            EscPos.partir(l.texto, 32).forEach { assertTrue("\"$it\" pasa de 32", it.length <= 32) }
        }
    }

    @Test fun impresoraRecibeSoloAsciiSinTildes() {
        val bytes = EscPos.recibo(Recibo.lineas(detalle, 32), 32)
        assertEquals(0x1B.toByte(), bytes[0]) // ESC @ (reiniciar)
        assertEquals('@'.code.toByte(), bytes[1])
        val texto = String(bytes, Charsets.US_ASCII)
        assertTrue(texto.contains("Bogota"))       // sin tilde
        assertTrue(texto.contains("Andrea Perez"))  // sin tilde
        assertTrue(texto.contains("282 min x \$50")) // × convertido
    }

    @Test fun whatsappIncluyeTotalYCalculo() {
        val w = Recibo.textoWhatsApp(detalle)
        assertTrue(w.contains("Placa MPP994"))
        assertTrue(w.contains("Cálculo: 282 min"))
        assertTrue(w.contains("TOTAL"))
    }

    @Test fun numeroDeWhatsappColombiano() {
        assertEquals("573001234567", Formato.numeroWhatsApp("300 123 4567"))
        assertEquals("573001234567", Formato.numeroWhatsApp("+57 300 1234567"))
        assertEquals(null, Formato.numeroWhatsApp("6015550101")) // fijo: no tiene WhatsApp
    }

    @Test fun formatos() {
        assertEquals("4h 42m", Formato.duracion(282))
        assertEquals("1d 1h 0m", Formato.duracion(1500))
        assertEquals("37 min", Formato.duracion(37))
    }
}
