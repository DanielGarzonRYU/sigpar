package co.sigpar.app.ui.abonados

import co.sigpar.app.ui.Ph
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.sigpar.app.data.Abonado
import co.sigpar.app.domain.Formato
import co.sigpar.app.domain.Placa
import co.sigpar.app.printing.ReciboPdf
import co.sigpar.app.ui.Cargando
import co.sigpar.app.ui.Insignia
import co.sigpar.app.ui.MensajeError
import co.sigpar.app.ui.MensajeInfo
import co.sigpar.app.ui.PlacaTag
import co.sigpar.app.ui.Seccion
import co.sigpar.app.ui.theme.Colores

private val ESTADOS = linkedMapOf("" to "Todos", "vigente" to "Vigentes", "por_vencer" to "Por vencer", "vencido" to "Vencidos")

@Composable
fun AbonadosScreen(vm: AbonadosViewModel) {
    val ctx = LocalContext.current
    var q by rememberSaveable { mutableStateOf("") }
    var estado by rememberSaveable { mutableStateOf("") }
    var nuevo by remember { mutableStateOf(false) }
    var renovar by remember { mutableStateOf<Abonado?>(null) }
    LaunchedEffect(Unit) { vm.cargar() }

    val filtrados = vm.lista.filter { a ->
        (estado.isEmpty() || a.estado == estado) &&
            (q.isBlank() || a.nombre.contains(q, true) || a.placa.contains(Placa.normalizar(q)) || a.documento.orEmpty().contains(q))
    }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 14.dp, bottom = 90.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            vm.mensaje?.let { item { MensajeInfo(it, Colores.libre) } }
            item { MensajeError(vm.error) }
            if (vm.alertas.isNotEmpty()) item {
                MensajeInfo("${vm.alertas.size} mensualidad(es) por vencer o vencidas. Toque \"Por vencer\" para verlas.", Colores.reservado)
            }
            item {
                OutlinedTextField(q, { q = it }, Modifier.fillMaxWidth(), singleLine = true,
                    leadingIcon = { Icon(Ph.magnifyingGlass, null) }, label = { Text("Buscar por nombre, placa o documento") })
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 6.dp)) {
                    ESTADOS.forEach { (k, v) -> FilterChip(estado == k, { estado = k }, { Text(v, fontSize = 12.sp) }) }
                }
            }
            if (vm.cargando && vm.lista.isEmpty()) item { Cargando() }
            if (!vm.cargando && filtrados.isEmpty()) item { Text("No hay abonados con ese filtro.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(12.dp)) }
            items(filtrados, key = { it.id }) { a ->
                Seccion {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        PlacaTag(a.placa)
                        Text(a.nombre, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        InsigniaEstado(a)
                    }
                    Text("${Formato.TIPOS[a.tipoVehiculo]} · ${Formato.fecha(a.fechaInicio)} → ${Formato.fecha(a.fechaFin)}" + (a.telefono?.let { " · $it" } ?: ""),
                        fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button({ renovar = a }) { Text("Renovar") }
                        val wa = Formato.numeroWhatsApp(a.telefono)
                        if (wa != null && a.estado in setOf("por_vencer", "vencido")) OutlinedButton({
                            ReciboPdf.abrirWhatsApp(ctx, wa, "Hola ${a.nombre}, le recordamos que la mensualidad de su vehículo ${a.placa}" +
                                " ${if (a.estado == "vencido") "venció" else "vence"} el ${Formato.fecha(a.fechaFin)}. Puede renovarla en la sede. ¡Gracias!")
                        }) { Text("WhatsApp") }
                    }
                }
            }
        }
        ExtendedFloatingActionButton(
            onClick = { vm.error = null; nuevo = true }, icon = { Icon(Ph.plus, null) }, text = { Text("Inscribir abonado") },
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
        )
    }

    if (nuevo) DialogoInscribir(vm) { nuevo = false }
    renovar?.let { a -> DialogoRenovar(vm, a) { renovar = null } }
}

@Composable
private fun InsigniaEstado(a: Abonado) {
    val (t, c) = when (a.estado) {
        "vigente" -> "Vigente" to Colores.libre
        "por_vencer" -> "Vence en ${a.diasRestantes} d" to Colores.reservado
        "vencido" -> "Vencido" to Colores.ocupado
        "programado" -> "Programado" to MaterialTheme.colorScheme.onSurface
        else -> "Inactivo" to Colores.inactivo
    }
    Insignia(t, c)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SelectorMeses(meses: Int, onMeses: (Int) -> Unit, metodo: String, onMetodo: (String) -> Unit) {
    Text("Meses", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { listOf(1, 2, 3, 6, 12).forEach { m -> FilterChip(meses == m, { onMeses(m) }, { Text("$m") }) } }
    Text("Método de pago", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        listOf("efectivo", "tarjeta", "transferencia", "app").forEach { k -> FilterChip(metodo == k, { onMetodo(k) }, { Text(Formato.METODOS.getValue(k)) }) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DialogoInscribir(vm: AbonadosViewModel, cerrar: () -> Unit) {
    var placa by remember { mutableStateOf("") }
    var nombre by remember { mutableStateOf("") }
    var documento by remember { mutableStateOf("") }
    var telefono by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var tipo by remember { mutableStateOf("carro") }
    var meses by remember { mutableIntStateOf(1) }
    var metodo by remember { mutableStateOf("efectivo") }
    var autoriza by remember { mutableStateOf(false) }
    val base = vm.valorMensual(tipo) * meses
    var valor by remember(tipo, meses) { mutableStateOf(base.toLong().toString()) }

    AlertDialog(
        onDismissRequest = cerrar,
        title = { Text("Inscribir abonado") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                MensajeError(vm.error)
                OutlinedTextField(placa, { placa = Placa.normalizar(it).take(8); Placa.tipoSugerido(placa)?.let { t -> tipo = if (t == Placa.Tipo.MOTO) "moto" else "carro" } },
                    label = { Text("Placa") }, singleLine = true, keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters))
                OutlinedTextField(nombre, { nombre = it }, label = { Text("Nombre completo") }, singleLine = true)
                OutlinedTextField(documento, { documento = it }, label = { Text("Documento") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                OutlinedTextField(telefono, { telefono = it }, label = { Text("Celular") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
                OutlinedTextField(email, { email = it }, label = { Text("Correo (para avisos)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { Formato.TIPOS.forEach { (k, v) -> FilterChip(tipo == k, { tipo = k }, { Text(v) }) } }
                SelectorMeses(meses, { meses = it }, metodo, { metodo = it })
                if (vm.esAdmin) OutlinedTextField(valor, { valor = it.filter(Char::isDigit) }, label = { Text("Valor (puede ajustarlo para un descuento)") },
                    singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                else Text("Valor: ${Formato.dinero(base)} (tarifa de la sede)", fontWeight = FontWeight.SemiBold)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(autoriza, { autoriza = it })
                    Text("El cliente autoriza el tratamiento de sus datos personales (Ley 1581, obligatorio).", fontSize = 13.sp)
                }
            }
        },
        confirmButton = {
            Button(
                { vm.inscribir(nombre.trim(), placa, tipo, documento.trim(), telefono.trim(), email.trim(), meses, metodo, valor.toDoubleOrNull(), autoriza, cerrar) },
                enabled = !vm.guardando && placa.length >= 5 && nombre.isNotBlank(),
            ) { Text("Inscribir y cobrar") }
        },
        dismissButton = { TextButton(cerrar) { Text("Cancelar") } },
    )
}

@Composable
private fun DialogoRenovar(vm: AbonadosViewModel, a: Abonado, cerrar: () -> Unit) {
    var meses by remember { mutableIntStateOf(1) }
    var metodo by remember { mutableStateOf("efectivo") }
    val base = vm.valorMensual(a.tipoVehiculo) * meses
    var valor by remember(meses) { mutableStateOf(base.toLong().toString()) }
    AlertDialog(
        onDismissRequest = cerrar,
        title = { Text("Renovar · ${a.placa}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                MensajeError(vm.error)
                Text("${a.nombre} · vence el ${Formato.fecha(a.fechaFin)}. El nuevo periodo empieza al día siguiente del vencimiento (o hoy si ya venció).", fontSize = 13.sp)
                SelectorMeses(meses, { meses = it }, metodo, { metodo = it })
                if (vm.esAdmin) OutlinedTextField(valor, { valor = it.filter(Char::isDigit) }, label = { Text("Valor (solo para descuentos)") },
                    singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                else Text("Valor: ${Formato.dinero(base)} (tarifa de la sede)", fontWeight = FontWeight.SemiBold)
            }
        },
        confirmButton = { Button({ vm.renovar(a, meses, metodo, valor.toDoubleOrNull(), cerrar) }, enabled = !vm.guardando) { Text("Renovar") } },
        dismissButton = { TextButton(cerrar) { Text("Cancelar") } },
    )
}
