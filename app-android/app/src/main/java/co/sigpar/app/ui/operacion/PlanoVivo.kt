package co.sigpar.app.ui.operacion

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import androidx.compose.ui.unit.sp
import co.sigpar.app.data.Espacio
import co.sigpar.app.data.Plano
import co.sigpar.app.domain.Formato
import co.sigpar.app.ui.Ph
import co.sigpar.app.ui.colorEstadoEspacio
import co.sigpar.app.ui.theme.Colores
import co.sigpar.app.ui.theme.Geist
import co.sigpar.app.ui.theme.GeistMono
import java.time.LocalDateTime

/** Huella de cada espacio en celdas [ancho, largo]; la misma tabla que la web y el servidor. */
private fun huella(tipo: String, rot: Int): Pair<Int, Int> {
    val (w, h) = when (tipo) { "moto", "bicicleta" -> 1 to 2; else -> 2 to 4 }
    return if (rot == 1) h to w else w to h
}

/**
 * Plano dibujado por el administrador, con el estado de cada espacio en vivo.
 * Un dedo desplaza la lista como siempre; dos dedos acercan y mueven el plano. Tocar un espacio lo abre.
 */
@Composable
fun PlanoVivo(
    plano: Plano,
    espacios: List<Espacio>,
    elegidoId: Int?,
    filtro: String,
    ahora: LocalDateTime,
    onEspacio: (Espacio) -> Unit,
) {
    val medidor = rememberTextMeasurer()
    val colores = MaterialTheme.colorScheme
    var zoom by remember { mutableFloatStateOf(1f) }
    var desplazamiento by remember { mutableStateOf(Offset.Zero) }
    val zoomAnimado by animateFloatAsState(zoom, tween(220), label = "zoom")
    val ubicados = espacios.filter { it.planoX != null && it.estado != "inactivo" }

    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val celdaDp = maxWidth / (plano.ancho + 1)
        val alto = min(celdaDp * (plano.alto + 1), 560.dp)
        Box(
            Modifier.fillMaxWidth().height(alto).clipToBounds()
                .background(colores.surfaceVariant, MaterialTheme.shapes.medium)
                .border(1.dp, colores.outlineVariant, MaterialTheme.shapes.medium),
        ) {
            Canvas(
                Modifier.fillMaxWidth().height(alto)
                    // Dos dedos: acercar y mover. Un dedo se deja pasar para que la pantalla siga desplazándose.
                    .pointerInput(plano) {
                        awaitEachGesture {
                            awaitFirstDown(requireUnconsumed = false)
                            do {
                                val ev = awaitPointerEvent()
                                if (ev.changes.count { it.pressed } >= 2) {
                                    val z = ev.calculateZoom()
                                    val c = ev.calculateCentroid()
                                    val nuevo = (zoom * z).coerceIn(1f, 4f)
                                    val f = nuevo / zoom
                                    desplazamiento = (desplazamiento - c) * f + c + ev.calculatePan()
                                    zoom = nuevo
                                    ev.changes.forEach { if (it.positionChanged()) it.consume() }
                                }
                            } while (ev.changes.any { it.pressed })
                            if (zoom <= 1.01f) desplazamiento = Offset.Zero
                        }
                    }
                    .pointerInput(plano, espacios) {
                        detectTapGestures(onDoubleTap = { zoom = 1f; desplazamiento = Offset.Zero }) { toque ->
                            val celda = size.width / (plano.ancho + 1f)
                            val p = (toque - desplazamiento) / zoom
                            val cx = p.x / celda - 0.5f
                            val cy = p.y / celda - 0.5f
                            ubicados.firstOrNull { e ->
                                val (w, h) = huella(e.tipoVehiculo, e.planoRot)
                                cx >= e.planoX!! && cx <= e.planoX + w && cy >= e.planoY!! && cy <= e.planoY + h
                            }?.let(onEspacio)
                        }
                    },
            ) {
                val celda = size.width / (plano.ancho + 1f)
                withTransform({ translate(desplazamiento.x, desplazamiento.y); scale(zoomAnimado, zoomAnimado, Offset.Zero) }) {
                    translate(celda / 2, celda / 2) {
                        dibujarPlano(plano, ubicados, celda, elegidoId, filtro, ahora, medidor, colores.surface, colores.onSurface, colores.onSurfaceVariant, colores.outline)
                    }
                }
            }
            Column(Modifier.align(Alignment.TopEnd).padding(4.dp)) {
                IconButton({ zoom = (zoom * 1.5f).coerceAtMost(4f) }, Modifier.size(40.dp)) { Icon(Ph.magnifyingGlassPlus, "Acercar", tint = colores.onSurfaceVariant) }
                if (zoom > 1f) IconButton({ zoom = 1f; desplazamiento = Offset.Zero }, Modifier.size(40.dp)) { Icon(Ph.magnifyingGlassMinus, "Ver todo", tint = colores.onSurfaceVariant) }
            }
        }
    }
    if (espacios.any { it.planoX == null && it.estado != "inactivo" }) {
        Text("Algunos espacios aún no están en el plano: véalos en la vista Lista.", fontSize = 12.sp, color = colores.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
    }
}

private fun DrawScope.dibujarPlano(
    plano: Plano, espacios: List<Espacio>, c: Float, elegidoId: Int?, filtro: String, ahora: LocalDateTime,
    medidor: TextMeasurer, superficie: Color, tinta: Color, tinta2: Color, borde: Color,
) {
    val r = CornerRadius(c * 0.25f)
    drawRoundRect(superficie, Offset.Zero, Size(plano.ancho * c, plano.alto * c), r)
    drawRoundRect(borde, Offset.Zero, Size(plano.ancho * c, plano.alto * c), r, style = Stroke(c * 0.08f))

    // Piezas del dibujo (vías primero para que queden debajo)
    val orden = listOf("zona", "via", "muro", "columna", "caseta", "entrada", "salida", "texto")
    for (p in plano.elementos.sortedBy { orden.indexOf(it.t) }) {
        val o = Offset(p.x * c, p.y * c)
        val s = Size(p.w * c, p.h * c)
        when (p.t) {
            "via" -> {
                drawRoundRect(tinta.copy(alpha = 0.09f), o, s, r)
                val efecto = PathEffect.dashPathEffect(floatArrayOf(c * 0.7f, c * 0.55f))
                if (p.w >= p.h) drawLine(Colores.placa, Offset(o.x + c * 0.5f, o.y + s.height / 2), Offset(o.x + s.width - c * 0.5f, o.y + s.height / 2), c * 0.12f, StrokeCap.Round, efecto)
                else drawLine(Colores.placa, Offset(o.x + s.width / 2, o.y + c * 0.5f), Offset(o.x + s.width / 2, o.y + s.height - c * 0.5f), c * 0.12f, StrokeCap.Round, efecto)
            }
            "zona" -> { drawRoundRect(tinta.copy(alpha = 0.05f), o, s, r); drawRoundRect(borde, o, s, r, style = Stroke(c * 0.06f)); rotulo(medidor, "Sin parqueo", o, s, c, tinta2, 0.55f) }
            "muro" -> drawRoundRect(tinta, o, s, CornerRadius(c * 0.1f))
            "columna" -> drawRoundRect(tinta2, o, s, CornerRadius(c * 0.1f))
            "caseta" -> { drawRoundRect(superficie, o, s, r); drawRoundRect(tinta, o, s, r, style = Stroke(c * 0.1f)); rotulo(medidor, "Caja", o, s, c, tinta, 0.6f) }
            "entrada", "salida" -> { drawRoundRect(Colores.placa, o, s, r); rotulo(medidor, if (p.t == "entrada") "Entrada" else "Salida", o, s, c, Colores.tinta, 0.6f) }
            "texto" -> rotulo(medidor, p.texto.orEmpty(), o, s, c, tinta2, 0.75f)
        }
    }

    // Espacios con su estado
    for (e in espacios) {
        val (w, h) = huella(e.tipoVehiculo, e.planoRot)
        val o = Offset((e.planoX!! + 0.08f) * c, (e.planoY!! + 0.08f) * c)
        val s = Size((w - 0.16f) * c, (h - 0.16f) * c)
        val color = colorEstadoEspacio(e.estado)
        val atenuar = filtro.isNotEmpty() && e.tipoVehiculo != filtro
        val a = if (atenuar) 0.25f else 1f
        val elegido = e.id == elegidoId
        drawRoundRect(if (elegido) Colores.placaSuave.copy(alpha = a) else color.copy(alpha = 0.14f * a), o, s, CornerRadius(c * 0.22f))
        drawRoundRect(if (elegido) tinta.copy(alpha = a) else color.copy(alpha = a), o, s, CornerRadius(c * 0.22f), style = Stroke(c * if (elegido) 0.2f else 0.09f))
        if (e.estado == "ocupado" && maxOf(w, h) >= 4) {
            val tiempo = Formato.duracion(Formato.minutosDesde(e.entradaAt, ahora))
            if (h > w) {
                rotulo(medidor, e.codigo, Offset(o.x, o.y), Size(s.width, s.height * 0.3f), c, tinta.copy(alpha = a), 0.5f, mono = true)
                rotulo(medidor, e.placa.orEmpty(), Offset(o.x, o.y + s.height * 0.32f), Size(s.width, s.height * 0.34f), c, Colores.ocupado.copy(alpha = a), 0.5f, mono = true)
                rotulo(medidor, tiempo, Offset(o.x, o.y + s.height * 0.64f), Size(s.width, s.height * 0.32f), c, tinta2.copy(alpha = a), 0.36f)
            } else {
                rotulo(medidor, e.codigo, o, Size(s.width * 0.34f, s.height), c, tinta.copy(alpha = a), 0.5f, mono = true)
                rotulo(medidor, e.placa.orEmpty(), Offset(o.x + s.width * 0.3f, o.y), Size(s.width * 0.7f, s.height * 0.55f), c, Colores.ocupado.copy(alpha = a), 0.55f, mono = true)
                rotulo(medidor, tiempo, Offset(o.x + s.width * 0.3f, o.y + s.height * 0.5f), Size(s.width * 0.7f, s.height * 0.45f), c, tinta2.copy(alpha = a), 0.4f)
            }
        } else {
            val texto = if (e.estado == "ocupado") e.placa ?: e.codigo else e.codigo
            rotulo(medidor, texto, o, s, c, (if (e.estado == "ocupado") Colores.ocupado else tinta).copy(alpha = a), 0.55f, mono = true)
        }
    }
}

/** Texto centrado que cabe en el rectángulo; en rectángulos angostos y altos va de lado. */
private fun DrawScope.rotulo(
    medidor: TextMeasurer, texto: String, o: Offset, s: Size, c: Float, color: Color, max: Float, mono: Boolean = false,
) {
    if (texto.isBlank()) return
    val girar = s.width < s.height && s.width < c * 2
    val largo = if (girar) s.height else s.width
    val ancho = if (girar) s.width else s.height
    val fuente = (largo * 0.78f / (texto.length * 0.62f)).coerceAtMost(c * max).coerceAtMost(ancho * 0.55f)
    if (fuente < 4f) return // demasiado pequeño para leerse: mejor no dibujarlo
    val estilo = TextStyle(
        fontFamily = if (mono) GeistMono else Geist, fontWeight = if (mono) FontWeight.Bold else FontWeight.SemiBold,
        fontSize = (fuente / density).sp, color = color,
    )
    val medida = medidor.measure(texto, estilo)
    val centro = Offset(o.x + s.width / 2, o.y + s.height / 2)
    val esquina = Offset(centro.x - medida.size.width / 2f, centro.y - medida.size.height / 2f)
    if (girar) rotate(-90f, centro) { drawText(medida, topLeft = esquina) } else drawText(medida, topLeft = esquina)
}
