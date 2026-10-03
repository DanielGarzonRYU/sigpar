package co.sigpar.app.ui

import co.sigpar.app.ui.theme.GeistMono
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.sigpar.app.data.DatosSesion
import co.sigpar.app.ui.theme.Colores
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(vm: SesionViewModel, aviso: String?) {
    val alcance = rememberCoroutineScope()
    var servidor by rememberSaveable { mutableStateOf(vm.servidor) }
    var email by rememberSaveable { mutableStateOf("") }
    var clave by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var enviando by remember { mutableStateOf(false) }
    var verServidor by rememberSaveable { mutableStateOf(false) }

    Column(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding().imePadding()
            .verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Spacer(Modifier.height(24.dp))
        // Logo: la "P" sobre el amarillo de la placa, con su borde de tinta
        Box(
            Modifier.size(56.dp).background(Colores.placa, RoundedCornerShape(14.dp)).border(2.dp, Colores.tinta, RoundedCornerShape(14.dp)),
            contentAlignment = Alignment.Center,
        ) { Text("P", color = Colores.tinta, fontSize = 28.sp, fontFamily = GeistMono, fontWeight = FontWeight.Bold) }
        Spacer(Modifier.height(8.dp))
        Text("Iniciar sesión", style = MaterialTheme.typography.headlineMedium)
        Text("Use la misma cuenta de la web: sirve para operadores, administradores y superadministradores.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        aviso?.let { MensajeInfo(it, Colores.reservado) }
        MensajeError(error)
        OutlinedTextField(email, { email = it }, Modifier.fillMaxWidth(), label = { Text("Correo") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
        OutlinedTextField(clave, { clave = it }, Modifier.fillMaxWidth(), label = { Text("Contraseña") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        BotonPlaca(
            onClick = { enviando = true; error = null; alcance.launch { error = vm.ingresar(servidor, email, clave); enviando = false } },
            enabled = !enviando, modifier = Modifier.fillMaxWidth(),
        ) {
            if (enviando) CircularProgressIndicator(Modifier.size(20.dp), color = Colores.tinta, strokeWidth = 2.dp)
            else Text("Ingresar", fontSize = 16.sp)
        }
        if (enviando) Text("Si el servidor estaba en reposo puede tardar hasta un minuto la primera vez.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("¿Olvidó su contraseña? Pídale a su administrador que la restablezca.",
            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton({ verServidor = !verServidor }) { Text(if (verServidor) "Ocultar servidor" else "Servidor: $servidor") }
        if (verServidor) {
            OutlinedTextField(servidor, { servidor = it }, Modifier.fillMaxWidth(), label = { Text("Dirección del servidor") }, singleLine = true,
                supportingText = { Text("Ej.: https://sigpar.onrender.com. En pruebas con cable USB: http://127.0.0.1:8080") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
        }
    }
}

@Composable
fun ElegirSedeScreen(s: DatosSesion, elegir: (Int) -> Unit, salir: () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Hola, ${s.usuario.nombre}", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text("¿En qué sede va a trabajar?", color = MaterialTheme.colorScheme.onSurfaceVariant)
        s.sedes.forEach { sede ->
            OutlinedButton({ elegir(sede.id) }, Modifier.fillMaxWidth().height(56.dp)) { Text(sede.nombre, fontSize = 16.sp) }
        }
        TextButton(salir) { Text("Cerrar sesión") }
    }
}
