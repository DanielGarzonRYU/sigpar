package co.sigpar.app.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.sigpar.app.ui.theme.Colores
import co.sigpar.app.ui.theme.GeistMono

/** Placa amarilla con borde de tinta, como en la web. */
@Composable
fun PlacaTag(placa: String, grande: Boolean = false) {
    Text(
        placa,
        fontFamily = GeistMono, fontWeight = FontWeight.Bold,
        fontSize = if (grande) 22.sp else 14.sp, letterSpacing = if (grande) 2.sp else 1.sp, color = Colores.tinta,
        modifier = Modifier
            .background(Colores.placa, RoundedCornerShape(5.dp))
            .border(1.5.dp, Colores.tinta, RoundedCornerShape(5.dp))
            .padding(horizontal = if (grande) 12.dp else 7.dp, vertical = 2.dp),
    )
}

/** Etiqueta cápsula de color (estado de espacio, abonado, etc.). */
@Composable
fun Insignia(texto: String, color: Color) {
    Text(
        texto, color = color, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.background(color.copy(alpha = 0.13f), RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 2.dp),
    )
}

fun iconoTipo(tipo: String): ImageVector = when (tipo) {
    "moto" -> Ph.motorcycle
    "bicicleta" -> Ph.bicycle
    else -> Ph.carProfile
}

fun colorEstadoEspacio(estado: String): Color = when (estado) {
    "disponible" -> Colores.libre
    "ocupado" -> Colores.ocupado
    "reservado" -> Colores.reservado
    else -> Colores.inactivo
}

/**
 * Botón principal "placa": amarillo con texto de tinta. Al presionarlo se hunde un poco (escala 0.97)
 * para que el operador sienta que la app lo escuchó, igual que en la web.
 */
@Composable
fun BotonPlaca(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    contenido: @Composable RowScope.() -> Unit,
) {
    val fuente = remember { MutableInteractionSource() }
    val presionado by fuente.collectIsPressedAsState()
    val escala by animateFloatAsState(if (presionado) 0.97f else 1f, tween(if (presionado) 90 else 160), label = "escala")
    Button(
        onClick, modifier.heightIn(min = 52.dp).graphicsLayer { scaleX = escala; scaleY = escala },
        enabled = enabled, interactionSource = fuente,
        shape = MaterialTheme.shapes.small,
        border = androidx.compose.foundation.BorderStroke(1.dp, Colores.tinta.copy(alpha = if (enabled) 0.9f else 0.2f)),
        colors = ButtonDefaults.buttonColors(containerColor = Colores.placa, contentColor = Colores.tinta),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
        content = contenido,
    )
}

/** Tarjeta con título opcional. */
@Composable
fun Seccion(modifier: Modifier = Modifier, titulo: String? = null, contenido: @Composable () -> Unit) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            titulo?.let { Text(it, style = MaterialTheme.typography.titleMedium) }
            contenido()
        }
    }
}

/** Aviso fijo arriba: sin internet o esperando al servidor (Render despertando). */
@Composable
fun AvisoConexion(enLinea: Boolean, conectando: Boolean) {
    if (enLinea && !conectando) return
    Row(
        Modifier.fillMaxWidth().background(if (!enLinea) Colores.ocupado else Colores.tinta).padding(horizontal = 16.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (!enLinea) Icon(Ph.cloudSlash, null, tint = Color.White, modifier = Modifier.size(18.dp))
        else CircularProgressIndicator(Modifier.size(16.dp), color = Colores.placa, strokeWidth = 2.dp)
        Spacer(Modifier.width(10.dp))
        Text(
            if (!enLinea) "Sin conexión a internet. Los datos no se actualizan hasta que vuelva la señal."
            else "Conectando con el servidor, puede tardar unos segundos.",
            color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
fun MensajeError(texto: String?) {
    texto ?: return
    Row(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.error.copy(alpha = 0.1f), MaterialTheme.shapes.small).padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(Ph.warning, null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(20.dp))
        Text(texto, color = MaterialTheme.colorScheme.error, fontSize = 14.sp)
    }
}

/**
 * Mensaje informativo. Sin color: estilo "placa" (fondo amarillo suave y texto de tinta).
 * Con color de estado (verde, naranja): fondo de ese color muy suave.
 */
@Composable
fun MensajeInfo(texto: String, color: Color = Color.Unspecified, icono: ImageVector? = null, contenido: (@Composable () -> Unit)? = null) {
    val acento = color == Color.Unspecified
    val fondo = if (acento) MaterialTheme.colorScheme.primaryContainer else color.copy(alpha = 0.11f)
    val tinta = if (acento) MaterialTheme.colorScheme.onPrimaryContainer else color
    Column(
        Modifier.fillMaxWidth().background(fondo, MaterialTheme.shapes.small).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            val i = icono ?: if (color == Colores.libre) Ph.checkCircle else if (color == Colores.reservado || color == Colores.ocupado) Ph.warning else Ph.info
            Icon(i, null, tint = tinta, modifier = Modifier.size(20.dp))
            Text(texto, color = tinta, fontSize = 14.sp)
        }
        contenido?.invoke()
    }
}

/** Carga: filas "esqueleto" con la forma del contenido que viene, en vez de un círculo girando. */
@Composable
fun Cargando(modifier: Modifier = Modifier, filas: Int = 3) {
    val t = rememberInfiniteTransition(label = "esqueleto")
    val a by t.animateFloat(0.45f, 1f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "alfa")
    Column(modifier.fillMaxWidth().padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        repeat(filas) { i ->
            Box(
                Modifier.fillMaxWidth(if (i % 2 == 0) 1f else 0.82f).height(56.dp).alpha(a)
                    .background(MaterialTheme.colorScheme.surfaceContainerHighest, MaterialTheme.shapes.medium),
            )
        }
    }
}

/** Dos valores alineados: "Tiempo ........ 2h 10m". */
@Composable
fun Dato(etiqueta: String, valor: String, destacado: Boolean = false) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(etiqueta, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(valor, fontWeight = if (destacado) FontWeight.Bold else FontWeight.Medium)
    }
}

/** Pantalla de arranque mientras se revisa la sesión guardada: solo el logo, centrado. */
@Composable
fun Arranque() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Box(
            Modifier.size(64.dp).background(Colores.placa, RoundedCornerShape(16.dp)).border(2.dp, Colores.tinta, RoundedCornerShape(16.dp)),
            contentAlignment = Alignment.Center,
        ) { Text("P", color = Colores.tinta, fontSize = 32.sp, fontFamily = GeistMono, fontWeight = FontWeight.Bold) }
    }
}
