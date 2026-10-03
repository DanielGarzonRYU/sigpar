package co.sigpar.app

import co.sigpar.app.domain.Placa
import co.sigpar.app.domain.VotoPlaca
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlacaTest {

    @Test fun normaliza() {
        assertEquals("ABC123", Placa.normalizar(" abc-123 "))
        assertEquals("ABC12D", Placa.normalizar("abc·12d"))
    }

    @Test fun reconoceFormatos() {
        assertTrue(Placa.esColombiana("ABC123"))
        assertTrue(Placa.esColombiana("ABC12D"))
        assertTrue(Placa.esColombiana("ABC12"))
        assertFalse(Placa.esColombiana("AB1234"))
        assertEquals(Placa.Tipo.CARRO, Placa.tipoSugerido("ABC123"))
        assertEquals(Placa.Tipo.MOTO, Placa.tipoSugerido("ABC12D"))
    }

    @Test fun corrigeConfusionesDelOcr() {
        // 8→B y 0→O en posiciones de letra; O→0 y S→5 en posiciones de número
        assertEquals("BOC105", Placa.corregir("80C1O5")!!.placa)
        assertEquals("ABC125", Placa.corregir("A8CIZ5")!!.placa)
        // "S" al final es una placa de moto legítima (no se "corrige" a 5)
        assertEquals("ABC12S", Placa.corregir("A8CIZS")!!.placa)
        // Letra final → moto
        assertEquals(Placa.Tipo.MOTO, Placa.corregir("XYZ45P")!!.tipo)
        // "O" final se interpreta como cero (carro), que es el error más común
        val c = Placa.corregir("ABC12O")!!
        assertEquals("ABC120", c.placa); assertEquals(Placa.Tipo.CARRO, c.tipo)
        // Imposible de corregir
        assertNull(Placa.corregir("A?C12#".replace("?", "%")))
        assertNull(Placa.corregir("ABCDEF"))
    }

    @Test fun encuentraPlacaEntreTextosDeLaImagen() {
        // Lo que ve la cámara en una placa de carro de Bogotá
        val r = Placa.candidatos(listOf("KLM 457", "BOGOTA D.C."))
        assertEquals("KLM457", r.first().placa)
        assertEquals(Placa.Tipo.CARRO, r.first().tipo)
    }

    @Test fun uneLasDosLineasDeUnaPlacaDeMoto() {
        val r = Placa.candidatos(listOf("XYZ", "45P", "MEDELLIN"))
        assertTrue(r.any { it.placa == "XYZ45P" && it.tipo == Placa.Tipo.MOTO })
    }

    @Test fun ignoraTextoQueNoEsPlaca() {
        assertTrue(Placa.candidatos(listOf("PARQUEADERO", "BIENVENIDOS")).isEmpty())
        assertTrue(Placa.candidatos(listOf("SALIDA", "PAGUE AQUI", "HORARIO 24 HORAS")).isEmpty())
        assertTrue(Placa.candidatos(listOf("TARIFA $4.000 HORA", "MAXIMO 2 HORAS", "CUPO 12")).isEmpty())
    }

    @Test fun placaConGuionOPunto() {
        assertEquals("KLM457", Placa.candidatos(listOf("KLM-457")).first().placa)
        assertEquals("KLM457", Placa.candidatos(listOf("KLM·457")).first().placa)
    }

    @Test fun placaConErroresSeCorrigeSiLaLineaTieneLargoDePlaca() {
        // La línea completa "8OC 1O5" (dos errores típicos) sí se corrige
        assertEquals("BOC105", Placa.candidatos(listOf("8OC 1O5")).first().placa)
    }

    @Test fun placaDentroDeTextoLargoSoloSiEsCasiExacta() {
        assertEquals("KLM457", Placa.candidatos(listOf("PLACA KLM457 GRACIAS")).first().placa)
    }

    @Test fun votacionExigeVariasLecturasIguales() {
        val v = VotoPlaca(ventana = 6, minimo = 3)
        val abc = Placa.Lectura("ABC123", Placa.Tipo.CARRO)
        assertNull(v.registrar(abc))
        assertNull(v.registrar(Placa.Lectura("ABC128", Placa.Tipo.CARRO))) // lectura suelta equivocada
        assertNull(v.registrar(abc))
        assertEquals("ABC123", v.registrar(abc)!!.placa)
    }
}
