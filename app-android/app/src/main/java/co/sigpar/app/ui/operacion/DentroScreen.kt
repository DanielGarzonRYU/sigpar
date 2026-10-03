package co.sigpar.app.ui.operacion

import androidx.compose.foundation.layout.size

import androidx.compose.foundation.background

import co.sigpar.app.ui.Ph
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.sigpar.app.domain.Formato
import co.sigpar.app.domain.Placa
import co.sigpar.app.ui.Insignia
import co.sigpar.app.ui.PlacaTag
import co.sigpar.app.ui.Seccion
import co.sigpar.app.ui.theme.Colores

/** Vehículos que están dentro ahora, con lo que llevan acumulado. */
@Composable
fun DentroScreen(vm: OperacionViewModel, cobrar: (Int) -> Unit) {
    var buscar by rememberSaveable { mutableStateOf("") }
    val q = buscar.trim().lowercase()
    val activos = vm.estado?.activos.orEmpty().filter {
        q.isEmpty() || it.placa.startsWith(Placa.normalizar(buscar)) || (it.propietario ?: it.abonado ?: "").lowercase().contains(q)
    }

    LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            OutlinedTextField(buscar, { buscar = it }, Modifier.fillMaxWidth(), singleLine = true,
                leadingIcon = { Icon(Ph.magnifyingGlass, null) }, label = { Text("Buscar placa o nombre (${vm.estado?.activos?.size ?: 0} dentro)") })
        }
        if (activos.isEmpty()) item {
            Text(if (vm.estado == null) "Cargando…" else "No hay vehículos dentro.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
        }
        items(activos, key = { it.id }) { m ->
            Seccion {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    IconoVehiculo(m.tipoVehiculo)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            PlacaTag(m.placa)
                            if (m.abonadoId != null) Insignia("Abonado", MaterialTheme.colorScheme.onSurface)
                        }
                        val nombre = m.propietario ?: m.abonado
                        if (!nombre.isNullOrBlank()) Text(nombre, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                        Text("Espacio ${m.espacio ?: "-"} · entró ${Formato.hora(m.entradaAt)} · ${Formato.duracion(m.minutosActuales)}",
                            fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(Formato.dinero(m.valorActual), fontWeight = FontWeight.Bold, color = if ((m.valorActual ?: 0.0) > 0) MaterialTheme.colorScheme.onSurface else Colores.libre)
                        FilledTonalButton({ cobrar(m.id) }, contentPadding = PaddingValues(horizontal = 12.dp)) {
                            Icon(Ph.signOut, null); Text(" Salida")
                        }
                    }
                }
            }
        }
    }
}

/** Ícono del tipo de vehículo con su tono: ayuda a distinguir carros, motos y bicicletas de un vistazo. */
@Composable
fun IconoVehiculo(tipo: String) {
    val (icono, fondo, tinta) = when (tipo) {
        "moto" -> Triple(Ph.motorcycle, Colores.placa.copy(alpha = 0.25f), MaterialTheme.colorScheme.onSurface)
        "bicicleta" -> Triple(Ph.bicycle, Colores.libre.copy(alpha = 0.16f), Colores.libre)
        else -> Triple(Ph.carProfile, MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant)
    }
    androidx.compose.foundation.layout.Box(
        Modifier.size(40.dp).background(fondo, androidx.compose.foundation.shape.RoundedCornerShape(12.dp)),
        contentAlignment = Alignment.Center,
    ) { Icon(icono, null, Modifier.size(22.dp), tint = tinta) }
}
