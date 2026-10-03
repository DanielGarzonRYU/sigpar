package co.sigpar.app.ui.operacion

import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.layout.Box
import androidx.compose.animation.togetherWith
import co.sigpar.app.ui.BotonPlaca
import co.sigpar.app.ui.theme.GeistMono
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.material3.OutlinedTextFieldDefaults
import co.sigpar.app.ui.Ph
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.sigpar.app.app
import co.sigpar.app.data.Espacio
import co.sigpar.app.domain.Formato
import co.sigpar.app.ui.Dato
import co.sigpar.app.ui.Insignia
import co.sigpar.app.ui.MensajeError
import co.sigpar.app.ui.MensajeInfo
import co.sigpar.app.ui.PlacaTag
import co.sigpar.app.ui.Seccion
import co.sigpar.app.ui.colorEstadoEspacio
import co.sigpar.app.ui.iconoTipo
import co.sigpar.app.ui.theme.Colores
import kotlinx.coroutines.launch

/** "Entrada" o "Salida" elegida arriba de la pantalla. */
enum class Modo { ENTRADA, SALIDA }

@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
fun OperacionScreen(vm: OperacionViewModel, modo: Modo, onModo: (Modo) -> Unit, abrirEscaner: (Modo) -> Unit) {
    var espacioMenu by remember { mutableStateOf<Espacio?>(null) }
    var filtro by rememberSaveable { mutableStateOf("") }
    var verPlano by rememberSaveable { mutableStateOf(true) }

    LazyColumn(
        Modifier.fillMaxWidth(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                SegmentedButton(modo == Modo.ENTRADA, { onModo(Modo.ENTRADA) }, SegmentedButtonDefaults.itemShape(0, 2),
                    icon = { Icon(Ph.signIn, null, Modifier.size(18.dp)) }) { Text("Entrada") }
                SegmentedButton(modo == Modo.SALIDA, { onModo(Modo.SALIDA) }, SegmentedButtonDefaults.itemShape(1, 2),
                    icon = { Icon(Ph.signOut, null, Modifier.size(18.dp)) }) { Text("Salida") }
            }
        }
        vm.mensaje?.let { m -> item(key = "msg") { Box(Modifier.animateItem()) { MensajeInfo(m, Colores.libre) } } }
        vm.error?.let { m -> item(key = "err") { Box(Modifier.animateItem()) { MensajeError(m) } } }
        item {
            // Entrada y salida se deslizan en la dirección de la pestaña elegida
            androidx.compose.animation.AnimatedContent(
                modo,
                transitionSpec = {
                    val dir = if (targetState == Modo.SALIDA) 1 else -1
                    (androidx.compose.animation.slideInHorizontally(androidx.compose.animation.core.tween(220)) { it / 8 * dir } +
                        androidx.compose.animation.fadeIn(androidx.compose.animation.core.tween(220))) togetherWith
                        androidx.compose.animation.fadeOut(androidx.compose.animation.core.tween(120))
                },
                label = "panel",
            ) { m -> if (m == Modo.ENTRADA) PanelEntrada(vm, abrirEscaner, onModo) else PanelSalida(vm, abrirEscaner) }
        }

        // ------------------------------------------------------------------ Mapa
        item {
            val e = vm.estado?.espacios.orEmpty().filter { it.estado != "inactivo" }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Mapa de espacios", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                Text(if (vm.estado == null) "Cargando…" else "${e.count { it.estado == "disponible" }} libres · ${e.count { it.estado == "ocupado" }} ocupados",
                    fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (vm.plano != null) {
                // La sede tiene plano dibujado: se puede ver como el parqueadero real o como lista ordenada
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                    SegmentedButton(verPlano, { verPlano = true }, SegmentedButtonDefaults.itemShape(0, 2),
                        icon = { Icon(Ph.mapTrifold, null, Modifier.size(18.dp)) }) { Text("Plano") }
                    SegmentedButton(!verPlano, { verPlano = false }, SegmentedButtonDefaults.itemShape(1, 2),
                        icon = { Icon(Ph.gridNine, null, Modifier.size(18.dp)) }) { Text("Lista") }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                listOf("" to "Todos", "carro" to "Carros", "moto" to "Motos", "bicicleta" to "Bicis").forEach { (k, v) ->
                    FilterChip(filtro == k, { filtro = k }, { Text(v) })
                }
            }
            vm.errorEstado?.let { MensajeError(it) }
        }
        val planoActual = vm.plano
        if (planoActual != null && verPlano) {
            item(key = "plano") {
                PlanoVivo(planoActual, vm.estado?.espacios.orEmpty(), vm.espacioElegido?.id, filtro, vm.ahora()) { esp ->
                    if (esp.estado == "ocupado") { onModo(Modo.SALIDA); esp.movimientoId?.let { vm.abrirSalida(it) } }
                    else espacioMenu = esp
                }
            }
        }
        val grupos = vm.estado?.espacios.orEmpty()
            .filter { it.estado != "inactivo" && (filtro.isEmpty() || it.tipoVehiculo == filtro) }
            .groupBy { it.tipoVehiculo }
        if (planoActual == null || !verPlano) for ((tipo, lista) in Formato.TIPOS.keys.mapNotNull { t -> grupos[t]?.let { t to it } }) {
            item(key = "g-$tipo") {
                val libres = lista.count { it.estado == "disponible" }
                Text(
                    "${Formato.TIPOS[tipo]}s · " + if (libres > 0) "$libres libres de ${lista.size}" else "sin cupos",
                    fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
                    color = if (libres > 0) MaterialTheme.colorScheme.onSurfaceVariant else Colores.ocupado,
                )
                // Tantas columnas como quepan (mínimo 84 dp por espacio) y todas del mismo ancho
                androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxWidth().padding(top = 6.dp)) {
                val columnas = maxOf(3, ((maxWidth + 8.dp) / (84.dp + 8.dp)).toInt())
                val ancho = (maxWidth - 8.dp * (columnas - 1)) / columnas
                FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    lista.forEach { esp ->
                        Puesto(esp, vm, elegido = vm.espacioElegido?.id == esp.id, ancho = ancho) {
                            // Ocupado: ir directo a cobrar su salida. Libre o reservado: mostrar opciones.
                            if (esp.estado == "ocupado") { onModo(Modo.SALIDA); esp.movimientoId?.let { vm.abrirSalida(it) } }
                            else espacioMenu = esp
                        }
                    }
                }
                }
            }
        }
        if (vm.estado != null && grupos.isEmpty()) item { Text("No hay espacios configurados en esta sede.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }

    espacioMenu?.let { e -> MenuEspacio(e, vm, onModo) { espacioMenu = null } }
}

@Composable
private fun Puesto(e: Espacio, vm: OperacionViewModel, elegido: Boolean, ancho: androidx.compose.ui.unit.Dp, onClick: () -> Unit) {
    // El color cambia suavemente cuando el espacio se ocupa o se libera (desde la web u otro celular)
    val color by androidx.compose.animation.animateColorAsState(colorEstadoEspacio(e.estado), androidx.compose.animation.core.tween(350), label = "color")
    val fuente = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
    val presionado by fuente.collectIsPressedAsState()
    val escala by androidx.compose.animation.core.animateFloatAsState(if (presionado) 0.96f else 1f, androidx.compose.animation.core.tween(140), label = "escala")
    Card(
        onClick = onClick,
        interactionSource = fuente,
        modifier = Modifier.width(ancho).height(100.dp).graphicsLayer { scaleX = escala; scaleY = escala },
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(containerColor = color.copy(alpha = 0.13f)),
        border = BorderStroke(if (elegido) 3.dp else 2.dp, if (elegido) MaterialTheme.colorScheme.onSurface else color.copy(alpha = 0.55f)),
    ) {
        Column(Modifier.fillMaxWidth().padding(6.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Icon(iconoTipo(e.tipoVehiculo), null, tint = color, modifier = Modifier.size(18.dp))
            Text(e.codigo, fontFamily = GeistMono, fontWeight = FontWeight.Bold, fontSize = 13.sp)
            when (e.estado) {
                "ocupado" -> {
                    Text(e.placa.orEmpty(), fontFamily = GeistMono, fontWeight = FontWeight.Bold, fontSize = 11.sp)
                    Text(Formato.duracion(Formato.minutosDesde(e.entradaAt, vm.ahora())), fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                "reservado" -> Text("Reservado", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                else -> Text(if (elegido) "Elegido" else "Libre", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** Qué hacer al tocar un espacio del mapa. */
@Composable
private fun MenuEspacio(e: Espacio, vm: OperacionViewModel, onModo: (Modo) -> Unit, cerrar: () -> Unit) {
    var nota by remember { mutableStateOf("") }
    when (e.estado) {
        "disponible" -> AlertDialog(
            onDismissRequest = cerrar,
            title = { Text("Espacio ${e.codigo}") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("${Formato.TIPOS[e.tipoVehiculo]} · libre")
                    OutlinedTextField(nota, { nota = it }, label = { Text("Nota para reservar (opcional)") }, singleLine = true)
                }
            },
            confirmButton = { Button({ vm.elegirParaEntrada(e); onModo(Modo.ENTRADA); cerrar() }) { Text("Usar para entrada") } },
            dismissButton = { TextButton({ vm.reservar(e, nota); cerrar() }) { Text("Reservar") } },
        )
        "reservado" -> AlertDialog(
            onDismissRequest = cerrar,
            title = { Text("Espacio ${e.codigo} reservado") },
            text = { Text(e.nota ?: "Sin nota") },
            confirmButton = { Button({ vm.elegirParaEntrada(e); onModo(Modo.ENTRADA); cerrar() }) { Text("Usar para entrada") } },
            dismissButton = { TextButton({ vm.liberar(e); cerrar() }) { Text("Liberar reserva") } },
        )
        else -> androidx.compose.runtime.LaunchedEffect(e.id) { cerrar() }
    }
}

@Composable
private fun CampoPlaca(valor: String, onCambio: (String) -> Unit, onCamara: () -> Unit, onListo: () -> Unit, etiqueta: String) {
    OutlinedTextField(
        value = valor, onValueChange = onCambio, label = { Text(etiqueta) }, singleLine = true,
        textStyle = MaterialTheme.typography.headlineSmall.copy(fontFamily = GeistMono, fontWeight = FontWeight.Bold, letterSpacing = 4.sp, textAlign = TextAlign.Center),
        placeholder = { Text("ABC123", Modifier.fillMaxWidth(), textAlign = TextAlign.Center, fontFamily = GeistMono, letterSpacing = 4.sp, color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.3f)) },
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Done, autoCorrectEnabled = false),
        keyboardActions = KeyboardActions(onDone = { onListo() }),
        trailingIcon = { IconButton(onCamara) { Icon(Ph.camera, "Leer placa con la cámara", tint = MaterialTheme.colorScheme.onPrimaryContainer) } },
        // La placa se escribe como se ve: fondo amarillo y borde de tinta
        shape = MaterialTheme.shapes.small,
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = MaterialTheme.colorScheme.primaryContainer, unfocusedContainerColor = MaterialTheme.colorScheme.primaryContainer,
            focusedBorderColor = MaterialTheme.colorScheme.onSurface, unfocusedBorderColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
            focusedTextColor = MaterialTheme.colorScheme.onPrimaryContainer, unfocusedTextColor = MaterialTheme.colorScheme.onPrimaryContainer,
            focusedLabelColor = MaterialTheme.colorScheme.onSurface,
        ),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun PanelEntrada(vm: OperacionViewModel, abrirEscaner: (Modo) -> Unit, onModo: (Modo) -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val alcance = rememberCoroutineScope()
    var verDatos by rememberSaveable { mutableStateOf(false) }
    var politica by remember { mutableStateOf<String?>(null) }

    Seccion {
        vm.ultimaEntrada?.let { (p, r) ->
            MensajeInfo("$p quedó en el espacio ${r.espacio}.", Colores.libre) { TextButton({ vm.verRecibo(r.id) }) { Text("Ver / imprimir tiquete") } }
        }
        CampoPlaca(vm.placa, vm::cambiarPlaca, { abrirEscaner(Modo.ENTRADA) }, { vm.registrarEntrada() }, "Placa del vehículo")

        vm.vehiculoDentro()?.let { m ->
            MensajeInfo("Este vehículo ya está dentro (espacio ${m.espacio}).", Colores.reservado) {
                TextButton({ onModo(Modo.SALIDA); vm.abrirSalida(m.id) }) { Text("Registrar su salida") }
            }
        }
        vm.abonado?.let { a ->
            val vigente = a.estado in setOf("vigente", "por_vencer")
            MensajeInfo(
                "Abonado: ${a.nombre}. " + when (a.estado) {
                    "vigente", "por_vencer" -> "Mensualidad vigente hasta el ${Formato.fecha(a.fechaFin)}: no paga al salir."
                    "vencido" -> "Su mensualidad venció el ${Formato.fecha(a.fechaFin)}: se cobra por tiempo. Ofrezca renovarla."
                    "programado" -> "Su mensualidad empieza el ${Formato.fecha(a.fechaInicio)}: hoy se cobra por tiempo."
                    else -> "Abonado desactivado: se cobra por tiempo."
                },
                if (vigente) Color.Unspecified else Colores.reservado,
            )
        }

        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            Formato.TIPOS.entries.forEachIndexed { i, (k, v) ->
                SegmentedButton(vm.tipo == k, { vm.tipo = k; if (vm.espacioElegido?.tipoVehiculo != k) vm.espacioElegido = null },
                    SegmentedButtonDefaults.itemShape(i, 3), icon = { Icon(co.sigpar.app.ui.iconoTipo(k), null, Modifier.size(18.dp)) }) { Text(v, fontSize = 13.sp) }
            }
        }

        val elegido = vm.espacioElegido
        val libres = vm.libres(vm.tipo)
        when {
            elegido != null -> Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Espacio elegido: ", color = MaterialTheme.colorScheme.onSurfaceVariant); Text(elegido.codigo, fontWeight = FontWeight.Bold)
                TextButton({ vm.espacioElegido = null }) { Text("Asignar automático") }
            }
            libres > 0 -> Text("$libres cupo(s) libre(s) para ${Formato.TIPOS[vm.tipo]?.lowercase()}. El espacio se asigna solo, o toque uno en el mapa.",
                fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            vm.estado != null -> MensajeError("Sin cupos para ${Formato.TIPOS[vm.tipo]?.lowercase()}. " +
                if (vm.estado!!.espacios.any { it.tipoVehiculo == vm.tipo && it.estado == "reservado" }) "Solo quedan espacios reservados (tóquelos en el mapa si corresponde)." else "Espere a que salga un vehículo.")
        }

        TextButton({ verDatos = !verDatos }) { Text(if (verDatos) "Ocultar datos del cliente" else "Datos del cliente (opcional)") }
        if (verDatos) {
            OutlinedTextField(vm.propietario, { vm.propietario = it.take(120) }, label = { Text("Propietario") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(vm.telefono, { vm.telefono = it.take(30) }, label = { Text("Celular (para enviarle el recibo por WhatsApp)") },
                singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), modifier = Modifier.fillMaxWidth())
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(vm.autoriza, { vm.autoriza = it })
                Column(Modifier.weight(1f)) {
                    Text("El cliente autoriza guardar su nombre y celular (Ley 1581). Sin autorización no se guardan.", fontSize = 13.sp)
                    Text("Ver política de datos", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, textDecoration = TextDecoration.Underline,
                        modifier = Modifier.clickable { alcance.launch { politica = runCatching { ctx.app.repo.politicaDatos() }.getOrElse { "No se pudo cargar la política." } } })
                }
            }
        }

        BotonPlaca(
            onClick = { vm.registrarEntrada() }, enabled = !vm.enviando && vm.placa.length >= 3,
            modifier = Modifier.fillMaxWidth(),
        ) { Icon(Ph.signIn, null); Text("  Registrar entrada", fontSize = 16.sp) }
    }

    politica?.let { p ->
        AlertDialog(onDismissRequest = { politica = null }, title = { Text("Tratamiento de datos personales") },
            text = { Text(p.ifBlank { "La empresa no ha registrado su política de datos." }) },
            confirmButton = { TextButton({ politica = null }) { Text("Entendido") } })
    }
}

@Composable
private fun PanelSalida(vm: OperacionViewModel, abrirEscaner: (Modo) -> Unit) {
    Seccion {
        CampoPlaca(vm.placaSalida, { vm.placaSalida = co.sigpar.app.domain.Placa.normalizar(it).take(8) }, { abrirEscaner(Modo.SALIDA) }, { vm.buscarSalida() }, "Placa del vehículo que sale")
        val m = vm.salida
        val c = vm.cotizacion
        if (m == null || c == null) {
            BotonPlaca({ vm.buscarSalida() }, Modifier.fillMaxWidth(), enabled = vm.placaSalida.isNotEmpty()) {
                Icon(Ph.magnifyingGlass, null); Text("  Buscar y calcular cobro")
            }
            return@Seccion
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            PlacaTag(m.placa)
            Insignia("${Formato.TIPOS[m.tipoVehiculo]} · ${m.espacio ?: "-"}", MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Dato("Entrada", Formato.fechaHora(m.entradaAt))
        Dato("Tiempo", Formato.duracion(c.minutos))
        m.propietario?.let { Dato("Propietario", it) }
        if (c.esAbonado) Dato("Abonado", m.abonado ?: "Sí")
        Text("Total a cobrar", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
        Text(Formato.dinero(c.valor), fontFamily = GeistMono, fontSize = 34.sp, fontWeight = FontWeight.Bold, letterSpacing = (-1).sp)
        Text(c.detalle, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (!c.esAbonado) {
            Text("Método de pago", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("efectivo", "tarjeta", "transferencia", "app").forEach { k ->
                    FilterChip(vm.metodo == k, { vm.metodo = k }, { Text(Formato.METODOS.getValue(k)) })
                }
            }
        }
        BotonPlaca(
            onClick = { vm.registrarSalida() }, enabled = !vm.enviando,
            modifier = Modifier.fillMaxWidth(),
        ) { Icon(Ph.signOut, null); Text(if (c.valor > 0) "  Registrar salida y cobrar ${Formato.dinero(c.valor)}" else "  Registrar salida", fontSize = 15.sp) }
        TextButton({ vm.cancelarSalida() }, Modifier.fillMaxWidth()) { Text("Cancelar") }
    }
}
