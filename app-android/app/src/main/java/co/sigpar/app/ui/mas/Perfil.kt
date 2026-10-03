package co.sigpar.app.ui.mas

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.sigpar.app.data.Usuario
import co.sigpar.app.ui.MensajeError
import co.sigpar.app.ui.Ph
import java.io.ByteArrayOutputStream

/** Iniciales para el avatar sin foto ("Carlos Ruiz" → "CR"). */
private fun iniciales(nombre: String) = nombre.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2).joinToString("") { it.first().uppercase() }.ifEmpty { "?" }

/** Foto guardada como "data:image/jpeg;base64,..." → imagen para mostrar (null si no hay o está dañada). */
private fun decodificar(foto: String?): Bitmap? = runCatching {
    val b64 = foto?.substringAfter("base64,", "")?.takeIf { it.isNotEmpty() } ?: return null
    val bytes = Base64.decode(b64, Base64.DEFAULT)
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
}.getOrNull()

/** Recorta al centro en un cuadrado de 256 px y lo devuelve como JPG liviano en texto (igual que la web). */
private fun fotoCuadrada(ctx: Context, uri: Uri): String? = runCatching {
    val limites = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, limites) }
    var muestra = 1
    while (minOf(limites.outWidth, limites.outHeight) / (muestra * 2) >= 256) muestra *= 2
    val original = ctx.contentResolver.openInputStream(uri)?.use {
        BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = muestra })
    } ?: return null
    val lado = minOf(original.width, original.height)
    val cuadrada = Bitmap.createBitmap(original, (original.width - lado) / 2, (original.height - lado) / 2, lado, lado)
    val final = Bitmap.createScaledBitmap(cuadrada, 256, 256, true)
    val salida = ByteArrayOutputStream()
    final.compress(Bitmap.CompressFormat.JPEG, 85, salida)
    "data:image/jpeg;base64," + Base64.encodeToString(salida.toByteArray(), Base64.NO_WRAP)
}.getOrNull()

/** Avatar del usuario: su foto o sus iniciales. */
@Composable
fun AvatarUsuario(nombre: String, foto: String?, tamano: Dp = 48.dp) {
    val imagen = remember(foto) { decodificar(foto)?.asImageBitmap() }
    Box(
        Modifier.size(tamano).clip(CircleShape).background(MaterialTheme.colorScheme.onSurface),
        contentAlignment = Alignment.Center,
    ) {
        if (imagen != null) Image(imagen, "Foto de perfil", Modifier.size(tamano), contentScale = ContentScale.Crop)
        else Text(iniciales(nombre), color = MaterialTheme.colorScheme.surface, fontWeight = FontWeight.SemiBold, fontSize = (tamano.value * 0.36f).sp)
    }
}

/**
 * Editar mi perfil: nombre y foto. guardar(nombre, foto, cambioFoto, alTerminar(error)).
 * El correo y el rol los cambia un administrador desde la web.
 */
@Composable
fun EditarPerfil(usuario: Usuario, guardar: (String, String?, Boolean, (String?) -> Unit) -> Unit, cerrar: () -> Unit) {
    val ctx = LocalContext.current
    var nombre by remember { mutableStateOf(usuario.nombre) }
    var foto by remember { mutableStateOf(usuario.foto) }
    var cambioFoto by remember { mutableStateOf(false) }
    var guardando by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val elegir = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            val f = fotoCuadrada(ctx, uri)
            if (f == null) error = "No se pudo abrir esa imagen. Pruebe con otra foto." else { foto = f; cambioFoto = true; error = null }
        }
    }
    AlertDialog(
        onDismissRequest = { if (!guardando) cerrar() },
        title = { Text("Mi perfil") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    AvatarUsuario(nombre.ifBlank { usuario.nombre }, foto, 72.dp)
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        OutlinedButton({ elegir.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }) {
                            Icon(Ph.camera, null, Modifier.size(18.dp)); Text(if (foto == null) "  Subir foto" else "  Cambiar foto")
                        }
                        if (foto != null) TextButton({ foto = null; cambioFoto = true }) { Text("Quitar foto") }
                    }
                }
                OutlinedTextField(nombre, { nombre = it }, Modifier.fillMaxWidth(), label = { Text("Nombre completo") }, singleLine = true)
                Text("Correo: ${usuario.email}", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("El correo y el rol los cambia un administrador desde la web.", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                MensajeError(error)
            }
        },
        confirmButton = {
            TextButton({
                if (nombre.trim().length < 3) { error = "Escriba su nombre completo"; return@TextButton }
                guardando = true
                guardar(nombre.trim(), foto, cambioFoto) { e -> guardando = false; if (e == null) cerrar() else error = e }
            }, enabled = !guardando) { Text(if (guardando) "Guardando..." else "Guardar") }
        },
        dismissButton = { TextButton(cerrar, enabled = !guardando) { Text("Cancelar") } },
    )
}
