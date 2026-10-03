package co.sigpar.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.sigpar.app.R

/**
 * Identidad "Asfalto + placa" (la misma de la web): grises de asfalto y el amarillo de la placa
 * colombiana como único color de marca. Verde, rojo y naranja solo para el estado de los espacios.
 */
object Colores {
    val placa = Color(0xFFF2C200)
    val placaSuave = Color(0xFFFFF3C4)
    val tinta = Color(0xFF16171A)
    val barra = Color(0xFF17181B)

    // Estados de los espacios (definidos en el requerimiento)
    val libre = Color(0xFF1C8F4D)
    val ocupado = Color(0xFFC93A2A)
    val reservado = Color(0xFFC56E05)
    val inactivo = Color(0xFF9A9CA2)
    val placaFondo = placa
}

val Geist = FontFamily(
    Font(R.font.geist_regular, FontWeight.Normal),
    Font(R.font.geist_medium, FontWeight.Medium),
    Font(R.font.geist_semibold, FontWeight.SemiBold),
    Font(R.font.geist_bold, FontWeight.Bold),
)

/** Placas, dinero y códigos de espacio: cifras de ancho fijo que no "bailan" al cambiar. */
val GeistMono = FontFamily(
    Font(R.font.geist_mono_medium, FontWeight.Medium),
    Font(R.font.geist_mono_bold, FontWeight.Bold),
)

// En claro, el amarillo sobre fondo claro no se lee como texto: los botones de texto, casillas y bordes
// activos van en tinta, y el amarillo queda para los botones principales (BotonPlaca) y la placa.
private val claro = lightColorScheme(
    primary = Colores.tinta, onPrimary = Color(0xFFF4F4F2),
    primaryContainer = Colores.placaSuave, onPrimaryContainer = Colores.tinta,
    secondary = Colores.tinta, onSecondary = Color(0xFFF4F4F2),
    secondaryContainer = Color(0xFFE6E6E2), onSecondaryContainer = Colores.tinta,
    background = Color(0xFFF4F4F2), surface = Color(0xFFFCFCFB), surfaceVariant = Color(0xFFEFEFEC),
    surfaceContainer = Color(0xFFF4F4F2), surfaceContainerLow = Color(0xFFFCFCFB), surfaceContainerHigh = Color(0xFFEFEFEC),
    surfaceContainerHighest = Color(0xFFE6E6E2), surfaceContainerLowest = Color.White,
    onBackground = Colores.tinta, onSurface = Colores.tinta, onSurfaceVariant = Color(0xFF53555C),
    error = Color(0xFFC3362A), outline = Color(0xFFCDCDC8), outlineVariant = Color(0xFFE0E0DC),
)

private val oscuro = darkColorScheme(
    primary = Colores.placa, onPrimary = Colores.tinta,
    primaryContainer = Color(0xFF3A3210), onPrimaryContainer = Color(0xFFFFE680),
    secondary = Color(0xFFEDEDEA), onSecondary = Colores.tinta,
    secondaryContainer = Color(0xFF292A2F), onSecondaryContainer = Color(0xFFEDEDEA),
    background = Color(0xFF111214), surface = Color(0xFF18191C), surfaceVariant = Color(0xFF1F2024),
    surfaceContainer = Color(0xFF18191C), surfaceContainerLow = Color(0xFF141517), surfaceContainerHigh = Color(0xFF1F2024),
    surfaceContainerHighest = Color(0xFF292A2F), surfaceContainerLowest = Color(0xFF0C0D0F),
    onBackground = Color(0xFFEDEDEA), onSurface = Color(0xFFEDEDEA), onSurfaceVariant = Color(0xFFA8A9AE),
    error = Color(0xFFEE6352), outline = Color(0xFF3A3B41), outlineVariant = Color(0xFF2A2B30),
)

private val base = Typography()
private fun TextStyle.g(tracking: Double = 0.0) = copy(fontFamily = Geist, letterSpacing = tracking.sp)

private val tipografia = Typography(
    displayLarge = base.displayLarge.g(-1.5), displayMedium = base.displayMedium.g(-1.0), displaySmall = base.displaySmall.g(-0.8),
    headlineLarge = base.headlineLarge.g(-0.8).copy(fontWeight = FontWeight.SemiBold),
    headlineMedium = base.headlineMedium.g(-0.6).copy(fontWeight = FontWeight.SemiBold),
    headlineSmall = base.headlineSmall.g(-0.4).copy(fontWeight = FontWeight.SemiBold),
    titleLarge = base.titleLarge.g(-0.3).copy(fontWeight = FontWeight.SemiBold),
    titleMedium = base.titleMedium.g(-0.1).copy(fontWeight = FontWeight.SemiBold),
    titleSmall = base.titleSmall.g().copy(fontWeight = FontWeight.SemiBold),
    bodyLarge = base.bodyLarge.g(), bodyMedium = base.bodyMedium.g(), bodySmall = base.bodySmall.g(),
    labelLarge = base.labelLarge.g().copy(fontWeight = FontWeight.SemiBold),
    labelMedium = base.labelMedium.g(), labelSmall = base.labelSmall.g(0.1),
)

/** Radios: campos 10, paneles 14, hojas 18 (igual que la web); los botones siguen la cápsula de Android. */
private val formas = Shapes(
    extraSmall = RoundedCornerShape(8.dp), small = RoundedCornerShape(10.dp), medium = RoundedCornerShape(14.dp),
    large = RoundedCornerShape(18.dp), extraLarge = RoundedCornerShape(22.dp),
)

@Composable
fun SigparTema(contenido: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) oscuro else claro,
        typography = tipografia, shapes = formas, content = contenido,
    )
}
