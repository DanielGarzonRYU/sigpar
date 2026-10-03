package co.sigpar.app.domain

/**
 * Reglas de placas colombianas y corrección de errores típicos del reconocimiento de texto (OCR).
 *
 *  - Carro / camioneta: 3 letras + 3 números      → ABC123
 *  - Moto:              3 letras + 2 números + letra → ABC12D
 *  - Moto antigua:      3 letras + 2 números      → ABC12
 *
 * El OCR confunde caracteres parecidos (0/O, 8/B, 1/I, 5/S…). Como en una placa se sabe qué posición
 * lleva letra y cuál número, se corrige cada carácter según su posición.
 */
object Placa {

    enum class Tipo { CARRO, MOTO }

    data class Lectura(val placa: String, val tipo: Tipo)

    private val CARRO = Regex("^[A-Z]{3}\\d{3}$")
    private val MOTO = Regex("^[A-Z]{3}\\d{2}[A-Z]$")
    private val MOTO_ANTIGUA = Regex("^[A-Z]{3}\\d{2}$")

    /** Número que el OCR suele leer en lugar de una letra (en posiciones de letra). */
    private val NUMERO_A_LETRA = mapOf('0' to 'O', '1' to 'I', '2' to 'Z', '4' to 'A', '5' to 'S', '6' to 'G', '7' to 'T', '8' to 'B')

    /** Letra que el OCR suele leer en lugar de un número (en posiciones de número). */
    private val LETRA_A_NUMERO = mapOf(
        'O' to '0', 'Q' to '0', 'D' to '0', 'U' to '0', 'I' to '1', 'L' to '1', 'J' to '1',
        'Z' to '2', 'A' to '4', 'S' to '5', 'G' to '6', 'T' to '7', 'B' to '8',
    )

    /** "abc-123 " → "ABC123" */
    fun normalizar(texto: String): String = texto.uppercase().filter { it in 'A'..'Z' || it in '0'..'9' }

    /** ¿Tiene formato colombiano? (informativo: bicicletas y placas extranjeras también se aceptan al escribirlas) */
    fun esColombiana(placa: String): Boolean = CARRO.matches(placa) || MOTO.matches(placa) || MOTO_ANTIGUA.matches(placa)

    /** Tipo sugerido por el formato de la placa. */
    fun tipoSugerido(placa: String): Tipo? = when {
        CARRO.matches(placa) -> Tipo.CARRO
        MOTO.matches(placa) || MOTO_ANTIGUA.matches(placa) -> Tipo.MOTO
        else -> null
    }

    /**
     * Intenta convertir un fragmento de 6 caracteres en una placa válida corrigiendo por posición.
     * Devuelve null si ni corrigiendo encaja.
     */
    fun corregir(fragmento: String): Lectura? = corregirContando(fragmento)?.first

    /** Igual que [corregir], pero también devuelve cuántos caracteres hubo que corregir. */
    private fun corregirContando(fragmento: String): Pair<Lectura, Int>? {
        val f = normalizar(fragmento)
        if (f.length != 6 && f.length != 5) return null
        var cambios = 0

        val letras = f.substring(0, 3).map { if (it.isDigit()) { cambios++; NUMERO_A_LETRA[it] ?: return null } else it }
        val numeros = f.substring(3, 5).map { if (it.isLetter()) { cambios++; LETRA_A_NUMERO[it] ?: return null } else it }
        val base = letras.joinToString("") + numeros.joinToString("")

        if (f.length == 5) return Lectura(base, Tipo.MOTO) to cambios

        val ultimo = f[5]
        return when {
            // Un número al final → carro
            ultimo.isDigit() -> Lectura(base + ultimo, Tipo.CARRO) to cambios
            // Una letra al final → moto (ABC12D). Excepción: si la letra es una confusión muy típica de
            // número (O, D, Q, U) se asume carro, porque esas letras son las que más se equivocan.
            ultimo in "OQDU" -> Lectura(base + LETRA_A_NUMERO.getValue(ultimo), Tipo.CARRO) to cambios + 1
            else -> Lectura(base + ultimo, Tipo.MOTO) to cambios
        }
    }

    /**
     * Busca placas dentro de las líneas de texto que detectó la cámara.
     * - Revisa cada línea (sin espacios ni guiones) con una ventana de 6 caracteres.
     * - Une líneas consecutivas: las placas de moto vienen en dos renglones ("ABC" arriba, "12D" abajo).
     * - Ignora textos como la ciudad ("BOGOTÁ D.C.") porque no encajan en el formato.
     * Las líneas deben venir ordenadas de más relevante (más grande) a menos.
     */
    fun candidatos(lineas: List<String>): List<Lectura> {
        // Nunca se corta una palabra por la mitad: en una placa real el texto se ve como "KLM 457", "KLM-457"
        // o "KLM457". Cortar en cualquier posición convertía letreros en placas ("HORARIO 24" → "RIO24H").
        val palabrasPorLinea = lineas.map { l -> l.trim().split(Regex("\\s+")).map(::normalizar).filter { it.isNotEmpty() } }
        // Una placa física es "3 letras" + "2 o 3 caracteres". Al unir palabras o renglones se exige esa forma,
        // así un letrero como "CUPO 12" (4 + 2) no se convierte en la placa "CUP012".
        val formaDePlaca = { a: String, b: String -> a.length == 3 && b.length in 2..3 }
        val textos = buildList {
            for (p in palabrasPorLinea) {
                addAll(p)                                                                        // "KLM457"
                for (i in 0 until p.size - 1) if (formaDePlaca(p[i], p[i + 1])) add(p[i] + p[i + 1]) // "KLM" + "457"
            }
            // Dos renglones seguidos: las placas de moto vienen en dos líneas ("XYZ" arriba, "45P" abajo)
            val lineasUnidas = palabrasPorLinea.map { it.joinToString("") }
            for (i in 0 until lineasUnidas.size - 1) {
                if (formaDePlaca(lineasUnidas[i], lineasUnidas[i + 1])) add(lineasUnidas[i] + lineasUnidas[i + 1])
            }
        }
        val salida = LinkedHashMap<String, Lectura>()
        for (t in textos) {
            if (t.length != 5 && t.length != 6) continue
            if (esColombiana(t)) { salida.putIfAbsent(t, Lectura(t, tipoSugerido(t)!!)); continue }
            // Con errores de lectura: máximo 2 correcciones y al menos uno de los dos primeros números debe
            // haberse leído como número (así "SALIDA" no se convierte en "SAL10A").
            val numeroOriginal = t[3].isDigit() || t[4].isDigit()
            corregirContando(t)?.let { (c, cambios) -> if (cambios <= 2 && numeroOriginal) salida.putIfAbsent(c.placa, c) }
        }
        return salida.values.toList()
    }
}

/**
 * Votación entre cuadros de video: una placa se propone solo cuando aparece igual en varias lecturas
 * seguidas. Así se evitan lecturas sueltas equivocadas (reflejos, movimiento, suciedad).
 */
class VotoPlaca(private val ventana: Int = 8, private val minimo: Int = 3) {
    private val historial = ArrayDeque<String>()

    /** Registra la mejor lectura de un cuadro (o null si no hubo) y devuelve la placa confirmada, si ya la hay. */
    fun registrar(lectura: Placa.Lectura?): Placa.Lectura? {
        historial.addLast(lectura?.placa ?: "")
        while (historial.size > ventana) historial.removeFirst()
        val ganador = historial.filter { it.isNotEmpty() }.groupingBy { it }.eachCount().maxByOrNull { it.value } ?: return null
        if (ganador.value < minimo) return null
        return Placa.Lectura(ganador.key, Placa.tipoSugerido(ganador.key) ?: Placa.Tipo.CARRO)
    }

    fun reiniciar() = historial.clear()
}
