package co.sigpar.app.ui.mas

import androidx.compose.foundation.layout.size
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.sigpar.app.BuildConfig
import co.sigpar.app.app
import co.sigpar.app.data.ApiException
import co.sigpar.app.data.DatosSesion
import co.sigpar.app.data.Impresora
import co.sigpar.app.domain.Formato
import co.sigpar.app.printing.EscPos
import co.sigpar.app.printing.ImpresoraBluetooth
import co.sigpar.app.printing.Linea
import co.sigpar.app.ui.Dato
import co.sigpar.app.ui.MensajeError
import co.sigpar.app.ui.MensajeInfo
import co.sigpar.app.ui.Seccion
import kotlinx.coroutines.launch

@Composable
fun MasScreen(
    s: DatosSesion, cambiarSede: () -> Unit, verGuia: (Int) -> Unit,
    guardarPerfil: (String, String?, Boolean, (String?) -> Unit) -> Unit, salir: () -> Unit,
) {
    val ctx = LocalContext.current
    val alcance = rememberCoroutineScope()
    var clave by remember { mutableStateOf(false) }
    var perfil by remember { mutableStateOf(false) }
    if (perfil) EditarPerfil(s.usuario, guardarPerfil) { perfil = false }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ComoUsar(verGuia)
        Seccion(titulo = "Mi cuenta") {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                AvatarUsuario(s.usuario.nombre, s.usuario.foto, 56.dp)
                Column(Modifier.weight(1f)) {
                    Text(s.usuario.nombre, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                    Text(s.usuario.email, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            OutlinedButton({ perfil = true }, Modifier.fillMaxWidth()) {
                androidx.compose.material3.Icon(co.sigpar.app.ui.Ph.pencilSimple, null, Modifier.size(18.dp)); Text("  Editar nombre y foto")
            }
            Dato("Correo", s.usuario.email)
            Dato("Rol", Formato.ROLES[s.usuario.rol] ?: s.usuario.rol)
            Dato("Sede", s.sedes.firstOrNull { it.id == s.sedeId }?.nombre ?: "-")
            if (s.sedes.size > 1) OutlinedButton(cambiarSede, Modifier.fillMaxWidth()) { Text("Cambiar de sede") }
            OutlinedButton({ clave = true }, Modifier.fillMaxWidth()) { Text("Cambiar contraseña") }
        }
        ConfigImpresora()
        Seccion(titulo = "Sistema") {
            Dato("Servidor", ctx.app.sesion.servidor)
            Dato("Versión de la app", BuildConfig.VERSION_NAME)
            Text("La app y la web usan la misma base de datos: lo que registre aquí aparece en la web en segundos, y al revés.",
                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Button(salir, Modifier.fillMaxWidth(), colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)) {
            Text("Cerrar sesión")
        }
    }

    if (clave) {
        var actual by remember { mutableStateOf("") }
        var nueva by remember { mutableStateOf("") }
        var error by remember { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { clave = false },
            title = { Text("Cambiar contraseña") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    MensajeError(error)
                    OutlinedTextField(actual, { actual = it }, label = { Text("Contraseña actual") }, visualTransformation = PasswordVisualTransformation(), singleLine = true)
                    OutlinedTextField(nueva, { nueva = it }, label = { Text("Nueva (mínimo 8 caracteres)") }, visualTransformation = PasswordVisualTransformation(), singleLine = true)
                }
            },
            confirmButton = {
                Button({
                    alcance.launch {
                        try { ctx.app.repo.cambiarClave(actual, nueva); clave = false } catch (e: ApiException) { error = e.message }
                    }
                }, enabled = nueva.length >= 8 && actual.isNotEmpty()) { Text("Guardar") }
            },
            dismissButton = { TextButton({ clave = false }) { Text("Cancelar") } },
        )
    }
}

/** Elegir la impresora térmica Bluetooth (se vincula antes en los ajustes de Bluetooth del celular). */
@Composable
private fun ConfigImpresora() {
    val ctx = LocalContext.current
    val alcance = rememberCoroutineScope()
    val sesion = ctx.app.sesion
    var actual by remember { mutableStateOf(sesion.impresora) }
    var lista by remember { mutableStateOf<List<ImpresoraBluetooth.Dispositivo>?>(null) }
    var columnas by remember { mutableIntStateOf(actual?.columnas ?: 32) }
    var error by remember { mutableStateOf<String?>(null) }
    var info by remember { mutableStateOf<String?>(null) }

    fun buscar() {
        error = null
        lista = runCatching { ImpresoraBluetooth.vinculados(ctx) }.getOrElse { error = it.message; null }
        if (lista?.isEmpty() == true) error = "No hay dispositivos vinculados. Vincule la impresora en Ajustes → Bluetooth del celular y vuelva aquí."
    }
    val permiso = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) buscar() else error = "Sin el permiso de Bluetooth no se puede usar la impresora."
    }

    Seccion(titulo = "Impresora de recibos (Bluetooth)") {
        if (!ImpresoraBluetooth.disponible(ctx)) { Text("Este celular no tiene Bluetooth. Use PDF o WhatsApp para el recibo."); return@Seccion }
        Text(actual?.let { "Impresora: ${it.nombre} · papel de ${if (it.columnas == 32) "58" else "80"} mm" } ?: "Sin impresora configurada",
            fontWeight = FontWeight.SemiBold)
        MensajeError(error)
        info?.let { MensajeInfo(it) }
        Text("Ancho del papel", fontSize = 13.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(32 to "58 mm", 48 to "80 mm").forEach { (cols, texto) ->
                FilterChip(columnas == cols, {
                    columnas = cols
                    actual?.let { imp -> val nueva = imp.copy(columnas = cols); actual = nueva; alcance.launch { sesion.guardarImpresora(nueva) } }
                }, { Text(texto) })
            }
        }
        OutlinedButton({
            val p = ImpresoraBluetooth.permiso
            if (p != null && !ImpresoraBluetooth.tienePermiso(ctx)) permiso.launch(p) else buscar()
        }, Modifier.fillMaxWidth()) { Text(if (actual == null) "Buscar impresoras vinculadas" else "Cambiar impresora") }

        lista?.forEach { d ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                RadioButton(actual?.mac == d.mac, {
                    val nueva = Impresora(d.mac, d.nombre, columnas)
                    alcance.launch { sesion.guardarImpresora(nueva) }
                    actual = nueva; lista = null; info = "Impresora guardada. Pruebe con \"Imprimir prueba\"."
                })
                Column { Text(d.nombre); Text(d.mac, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }

        actual?.let { imp ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button({
                    error = null; info = "Imprimiendo prueba…"
                    alcance.launch {
                        val prueba = listOf(Linea("SIGPAR", centro = true, negrita = true, grande = true), Linea("Prueba de impresion", centro = true),
                            Linea(separador = true), Linea("Si lee esto, la impresora quedo lista.", centro = true))
                        runCatching { ImpresoraBluetooth.imprimir(ctx, imp.mac, EscPos.recibo(prueba, imp.columnas)) }
                            .onSuccess { info = "Prueba enviada a ${imp.nombre}." }.onFailure { info = null; error = it.message }
                    }
                }) { Text("Imprimir prueba") }
                TextButton({ alcance.launch { sesion.guardarImpresora(null) }; actual = null; info = null }) { Text("Quitar") }
            }
        }
    }
}

/** Cómo usar: la guía completa y cada tema por separado, para repasarlos cuando se quiera. */
@Composable
private fun ComoUsar(verGuia: (Int) -> Unit) {
    val ctx = LocalContext.current
    var reiniciada by remember { mutableStateOf(false) }
    Seccion(titulo = "Cómo usar") {
        Text("Guía paso a paso de lo más importante. Repásela cuando quiera: no cambia nada.",
            fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        co.sigpar.app.ui.BotonPlaca({ verGuia(0) }, Modifier.fillMaxWidth()) {
            androidx.compose.material3.Icon(co.sigpar.app.ui.Ph.handTap, null, Modifier.size(18.dp)); Text("  Ver la guía completa", fontSize = 16.sp)
        }
        Text("O vaya directo a un tema:", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Column {
            co.sigpar.app.ui.TEMAS_GUIA.forEachIndexed { i, (titulo, icono) ->
                if (i == 0) return@forEachIndexed
                if (i > 1) androidx.compose.material3.HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Row(
                    Modifier.fillMaxWidth().clip(MaterialTheme.shapes.small).clickable { verGuia(i) }.padding(vertical = 12.dp, horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    androidx.compose.material3.Icon(icono, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(titulo, Modifier.weight(1f).padding(start = 12.dp), fontSize = 15.sp)
                    androidx.compose.material3.Icon(co.sigpar.app.ui.Ph.caretRight, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        TextButton({ co.sigpar.app.ui.reiniciarGuia(ctx); reiniciada = true }, enabled = !reiniciada) {
            Text(if (reiniciada) "Listo: saldrá sola la próxima vez que abra la app" else "Que la guía salga sola al abrir la app")
        }
        Text("También puede tocar el signo de pregunta, arriba a la derecha, en cualquier pantalla.",
            fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
