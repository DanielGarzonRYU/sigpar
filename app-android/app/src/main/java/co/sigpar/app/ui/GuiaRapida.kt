package co.sigpar.app.ui

import android.content.Context
import androidx.core.content.edit
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import co.sigpar.app.ui.theme.Colores
import co.sigpar.app.ui.theme.GeistMono
import kotlinx.coroutines.launch
import kotlin.math.absoluteValue

private class PaginaGuia(val icono: ImageVector, val titulo: String, val texto: String, val ejemplo: (@Composable () -> Unit)? = null)

private val PAGINAS = listOf(
    PaginaGuia(Ph.carProfile, "Bienvenido a SIGPAR",
        "La app del operador. Todo lo que registre aquí aparece al instante en la web del administrador, y al revés."),
    PaginaGuia(Ph.signIn, "Registrar una entrada",
        "Escriba la placa o toque la cámara y apunte a la placa. El tipo de vehículo y el espacio se eligen solos. Luego toque Registrar entrada.") {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            PlacaTag("ABC123", grande = true); Icon(Ph.camera, null, Modifier.size(28.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    },
    PaginaGuia(Ph.mapTrifold, "El mapa en vivo",
        "Verde está libre, rojo ocupado y naranja reservado. Toque un espacio rojo para cobrar su salida. Si el administrador dibujó el plano, lo verá igual a su parqueadero: pellizque para acercar.") {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("C-01" to Colores.libre, "C-02" to Colores.ocupado, "C-03" to Colores.reservado, "C-04" to Colores.libre).forEach { (c, col) ->
                Box(
                    Modifier.size(52.dp, 70.dp).background(col.copy(alpha = 0.14f), RoundedCornerShape(10.dp)).border(1.5.dp, col, RoundedCornerShape(10.dp)),
                    contentAlignment = Alignment.Center,
                ) { Text(c, fontFamily = GeistMono, fontWeight = FontWeight.Bold, fontSize = 12.sp) }
            }
        }
    },
    PaginaGuia(Ph.cashRegister, "Cobrar la salida",
        "En Salida escriba o escanee la placa: el valor se calcula solo con la tarifa de la sede. Elija cómo pagó el cliente y registre la salida."),
    PaginaGuia(Ph.printer, "Entregar el recibo",
        "Imprímalo en la impresora Bluetooth, compártalo en PDF o envíelo por WhatsApp al cliente. La impresora se configura una sola vez en Más."),
    PaginaGuia(Ph.cloudSlash, "Si se va la señal",
        "Arriba aparece un aviso. Espere a que vuelva la conexión antes de registrar: así nunca queda un cobro a medias. Esta guía está siempre en el signo de pregunta de arriba y en Más, Cómo usar."),
)

/** Temas de la guía (para la sección Cómo usar): título e ícono de cada página. */
val TEMAS_GUIA: List<Pair<String, ImageVector>> get() = PAGINAS.map { it.titulo to it.icono }

private const val PREFS = "sigpar_guia"
private const val CLAVE = "vista_v1"

fun guiaVista(ctx: Context): Boolean = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(CLAVE, false)
private fun marcarGuia(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit { putBoolean(CLAVE, true) }
/** La guía vuelve a abrirse sola la próxima vez que se abra la app (por ejemplo, para un operador nuevo). */
fun reiniciarGuia(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit { putBoolean(CLAVE, false) }

/** Guía rápida de las acciones más importantes: aparece la primera vez y desde Más > Cómo usar. inicio: tema donde abre. */
@Composable
fun GuiaRapida(inicio: Int = 0, onCerrar: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val estado = rememberPagerState(initialPage = inicio.coerceIn(0, PAGINAS.lastIndex)) { PAGINAS.size }
    val alcance = rememberCoroutineScope()
    val cerrar = { marcarGuia(ctx); onCerrar() }

    Dialog(onDismissRequest = cerrar, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(
            Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding().padding(24.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Guía rápida", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp, modifier = Modifier.weight(1f))
                TextButton(cerrar) { Text("Saltar") }
            }
            HorizontalPager(estado, Modifier.weight(1f).fillMaxWidth()) { i ->
                val p = PAGINAS[i]
                // Cada página entra con un leve desplazamiento y aparece mientras se desliza
                // (se lee la posición al dibujar, no al componer: no se recompone en cada cuadro)
                // Centrada si cabe; si la pantalla es baja (celular en horizontal) se desplaza
                BoxWithConstraints(Modifier.fillMaxSize()) {
                val alto = maxHeight
                Column(
                    Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).heightIn(min = alto).graphicsLayer {
                        val distancia = ((estado.currentPage - i) + estado.currentPageOffsetFraction).absoluteValue.coerceIn(0f, 1f)
                        alpha = 1f - distancia * 0.6f; translationY = distancia * 40f
                    },
                    verticalArrangement = Arrangement.Center,
                ) {
                    Box(
                        Modifier.size(72.dp).background(Colores.placa, RoundedCornerShape(20.dp)).border(2.dp, Colores.tinta, RoundedCornerShape(20.dp)),
                        contentAlignment = Alignment.Center,
                    ) { Icon(p.icono, null, Modifier.size(36.dp), tint = Colores.tinta) }
                    Spacer(Modifier.height(28.dp))
                    Text(p.titulo, style = MaterialTheme.typography.headlineMedium)
                    Spacer(Modifier.height(12.dp))
                    Text(p.texto, fontSize = 17.sp, lineHeight = 26.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    p.ejemplo?.let { Spacer(Modifier.height(24.dp)); it() }
                }
                }
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    PAGINAS.indices.forEach { k ->
                        val activo = k == estado.currentPage
                        val ancho by animateDpAsState(if (activo) 22.dp else 7.dp, tween(240), label = "punto")
                        val alfa by animateFloatAsState(if (activo) 1f else 0.3f, tween(200), label = "alfa")
                        Box(Modifier.height(7.dp).width(ancho).background(MaterialTheme.colorScheme.onSurface.copy(alpha = alfa), RoundedCornerShape(4.dp)))
                    }
                }
                val ultima = estado.currentPage == PAGINAS.lastIndex
                BotonPlaca({ if (ultima) cerrar() else alcance.launch { estado.animateScrollToPage(estado.currentPage + 1) } }) {
                    Text(if (ultima) "Empezar" else "Siguiente", fontSize = 16.sp)
                }
            }
        }
    }
}
