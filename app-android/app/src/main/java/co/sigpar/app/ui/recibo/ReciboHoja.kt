package co.sigpar.app.ui.recibo

import co.sigpar.app.ui.Ph
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.sigpar.app.app
import co.sigpar.app.data.MovimientoDetalle
import co.sigpar.app.domain.Formato
import co.sigpar.app.printing.EscPos
import co.sigpar.app.printing.ImpresoraBluetooth
import co.sigpar.app.printing.Recibo
import co.sigpar.app.printing.ReciboPdf
import co.sigpar.app.ui.MensajeError
import co.sigpar.app.ui.MensajeInfo
import kotlinx.coroutines.launch

/** Recibo de pago o tiquete de entrada con todas las formas de entregarlo. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReciboHoja(d: MovimientoDetalle, onCerrar: () -> Unit, irAImpresora: () -> Unit) {
    val ctx = LocalContext.current
    val alcance = rememberCoroutineScope()
    val impresora = ctx.app.sesion.impresora
    var estado by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var imprimiendo by remember { mutableStateOf(false) }
    val salida = d.movimiento.estado == "finalizado"
    val whatsapp = Formato.numeroWhatsApp(d.movimiento.telefono)

    ModalBottomSheet(onDismissRequest = onCerrar, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(if (salida) "Recibo de pago" else "Tiquete de entrada", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)

            // Vista previa, igual a lo que sale impreso
            Column(
                Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(8.dp)).border(1.dp, Color(0xFFBBBBBB), RoundedCornerShape(8.dp)).padding(12.dp),
            ) {
                Recibo.lineas(d, 32).forEach { l ->
                    if (l.separador) Text("-".repeat(32), fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = Color.Black)
                    else Text(
                        l.texto, fontFamily = FontFamily.Monospace, color = Color.Black,
                        fontSize = if (l.grande) 16.sp else 12.sp, fontWeight = if (l.negrita) FontWeight.Bold else FontWeight.Normal,
                        textAlign = if (l.centro) TextAlign.Center else TextAlign.Start, modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            estado?.let { MensajeInfo(it) }
            MensajeError(error)

            // 1) Impresora térmica Bluetooth
            if (impresora != null) {
                Button(
                    onClick = {
                        imprimiendo = true; error = null; estado = "Imprimiendo en ${impresora.nombre}…"
                        alcance.launch {
                            runCatching { ImpresoraBluetooth.imprimir(ctx, impresora.mac, EscPos.recibo(Recibo.lineas(d, impresora.columnas), impresora.columnas)) }
                                .onSuccess { estado = "Impreso en ${impresora.nombre}" }
                                .onFailure { estado = null; error = it.message }
                            imprimiendo = false
                        }
                    },
                    enabled = !imprimiendo, modifier = Modifier.fillMaxWidth(),
                ) { Icon(Ph.bluetooth, null); Text("  Imprimir en ${impresora.nombre}") }
            } else {
                OutlinedButton(onClick = { onCerrar(); irAImpresora() }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Ph.bluetooth, null); Text("  Configurar impresora Bluetooth")
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                // 2) PDF: compartir (WhatsApp, correo…) o imprimir por WiFi con el sistema
                OutlinedButton(onClick = {
                    error = null
                    runCatching { ReciboPdf.compartir(ctx, ReciboPdf.crear(ctx, d)) }.onFailure { error = "No se pudo crear el PDF: ${it.message}" }
                }, modifier = Modifier.weight(1f)) { Icon(Ph.filePdf, null); Text(" PDF") }
                OutlinedButton(onClick = {
                    error = null
                    runCatching { ReciboPdf.imprimirSistema(ctx, ReciboPdf.crear(ctx, d)) }.onFailure { error = "No se pudo imprimir: ${it.message}" }
                }, modifier = Modifier.weight(1f)) { Icon(Ph.printer, null); Text(" Imprimir") }
            }

            // 3) WhatsApp al celular del cliente (si lo dejó y autorizó)
            if (whatsapp != null) {
                OutlinedButton(onClick = {
                    if (!ReciboPdf.abrirWhatsApp(ctx, whatsapp, Recibo.textoWhatsApp(d))) error = "WhatsApp no está instalado en este celular."
                }, modifier = Modifier.fillMaxWidth()) { Icon(Ph.whatsappLogo, null); Text("  Enviar por WhatsApp al ${d.movimiento.telefono}") }
            }

            Button(onClick = onCerrar, modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) { Text("Listo") }
        }
    }
}
