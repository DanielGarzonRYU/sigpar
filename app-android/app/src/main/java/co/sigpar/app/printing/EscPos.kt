package co.sigpar.app.printing

import java.io.ByteArrayOutputStream

/**
 * Comandos ESC/POS: el "idioma" de casi todas las impresoras térmicas de 58 mm y 80 mm
 * (las que se usan en parqueaderos, tiendas y restaurantes).
 */
object EscPos {
    private const val ESC: Byte = 0x1B
    private const val GS: Byte = 0x1D

    fun recibo(lineas: List<Linea>, columnas: Int): ByteArray {
        val out = ByteArrayOutputStream()
        fun b(vararg x: Int) = x.forEach { out.write(it) }
        fun texto(s: String) = out.write(Recibo.sinTildes(s).toByteArray(Charsets.US_ASCII))

        b(ESC.toInt(), '@'.code)                           // reiniciar impresora
        for (l in lineas) {
            if (l.separador) { b(ESC.toInt(), 'a'.code, 0); texto("-".repeat(columnas)); b(0x0A); continue }
            b(ESC.toInt(), 'a'.code, if (l.centro) 1 else 0)  // alineación
            b(ESC.toInt(), 'E'.code, if (l.negrita) 1 else 0) // negrita
            b(GS.toInt(), '!'.code, if (l.grande) 0x11 else 0) // doble alto y ancho
            for (parte in partir(l.texto, if (l.grande) columnas / 2 else columnas)) { texto(parte); b(0x0A) }
        }
        b(ESC.toInt(), 'E'.code, 0); b(GS.toInt(), '!'.code, 0); b(ESC.toInt(), 'a'.code, 0)
        b(ESC.toInt(), 'd'.code, 4)                          // avanzar 4 líneas
        b(GS.toInt(), 'V'.code, 66, 0)                       // corte parcial (se ignora si no tiene cortador)
        return out.toByteArray()
    }

    /** Parte un texto largo en renglones del ancho del papel, sin cortar palabras si se puede. */
    fun partir(texto: String, ancho: Int): List<String> {
        if (texto.length <= ancho) return listOf(texto)
        val res = mutableListOf<String>()
        var actual = StringBuilder()
        for (palabra in texto.split(' ')) {
            if (actual.isNotEmpty() && actual.length + 1 + palabra.length > ancho) { res += actual.toString(); actual = StringBuilder() }
            if (palabra.length > ancho) { palabra.chunked(ancho).forEach { res += it }; continue }
            if (actual.isNotEmpty()) actual.append(' ')
            actual.append(palabra)
        }
        if (actual.isNotEmpty()) res += actual.toString()
        return res
    }
}
