package co.sigpar.app.ui.caja

import co.sigpar.app.ui.Ph
import android.app.Application
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import co.sigpar.app.app
import co.sigpar.app.data.ApiException
import co.sigpar.app.data.CajaResp
import co.sigpar.app.domain.Formato
import co.sigpar.app.ui.Cargando
import co.sigpar.app.ui.Dato
import co.sigpar.app.ui.MensajeError
import co.sigpar.app.ui.Seccion
import kotlinx.coroutines.launch
import java.time.LocalDate

class CajaViewModel(application: Application) : AndroidViewModel(application) {
    private val repo = application.app.repo
    var fecha by mutableStateOf(LocalDate.now()); private set
    var datos by mutableStateOf<CajaResp?>(null); private set
    var error by mutableStateOf<String?>(null); private set
    var cargando by mutableStateOf(false); private set

    fun cargar(f: LocalDate = fecha) = viewModelScope.launch {
        fecha = f; cargando = true
        try { datos = repo.caja(f.toString()); error = null } catch (e: ApiException) { error = e.message } finally { cargando = false }
    }
}

/** Cierre de caja: lo recaudado por cada operador en el día (salidas cobradas y mensualidades). */
@Composable
fun CajaScreen(vm: CajaViewModel) {
    LaunchedEffect(Unit) { vm.cargar() }
    LaunchedEffect(vm.fecha) {
        while (vm.fecha == LocalDate.now()) { kotlinx.coroutines.delay(15_000); vm.cargar() }
    }
    val d = vm.datos
    LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconButton({ vm.cargar(vm.fecha.minusDays(1)) }) { Icon(Ph.caretLeft, "Día anterior") }
                Text(if (vm.fecha == LocalDate.now()) "Hoy · ${Formato.fecha(vm.fecha.toString())}" else Formato.fecha(vm.fecha.toString()),
                    Modifier.weight(1f), fontWeight = FontWeight.SemiBold, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                IconButton({ vm.cargar(vm.fecha.plusDays(1)) }, enabled = vm.fecha < LocalDate.now()) { Icon(Ph.caretRight, "Día siguiente") }
            }
        }
        item { MensajeError(vm.error) }
        if (vm.cargando && d == null) item { Cargando() }
        if (d != null) {
            item {
                Seccion {
                    Text("Total del día", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(Formato.dinero(d.total), fontSize = 30.sp, fontWeight = FontWeight.ExtraBold)
                    Dato("Efectivo esperado en caja", Formato.dinero(d.efectivo), destacado = true)
                    Dato("Tarjeta, transferencia y app", Formato.dinero(d.total - d.efectivo))
                    Text("Compare el efectivo esperado con el dinero físico de la caja.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (d.resumen.isEmpty()) item { Text("Sin recaudos en esta fecha.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(8.dp)) }
            items(d.resumen) { f ->
                val concepto = if (f.metodo.startsWith("mensualidad_")) "Mensualidad · ${Formato.METODOS[f.metodo.removePrefix("mensualidad_")]}" else Formato.METODOS[f.metodo] ?: f.metodo
                Seccion {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        androidx.compose.foundation.layout.Column(Modifier.weight(1f)) {
                            Text(f.usuario, fontWeight = FontWeight.SemiBold)
                            Text("$concepto · ${f.cantidad} transacción(es)", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text(Formato.dinero(f.total), fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}
