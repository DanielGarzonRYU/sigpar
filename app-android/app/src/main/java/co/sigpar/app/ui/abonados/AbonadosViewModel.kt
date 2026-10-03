package co.sigpar.app.ui.abonados

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import co.sigpar.app.app
import co.sigpar.app.data.Abonado
import co.sigpar.app.data.Alerta
import co.sigpar.app.data.ApiException
import co.sigpar.app.data.Tarifa
import co.sigpar.app.domain.Formato
import kotlinx.coroutines.launch

class AbonadosViewModel(application: Application) : AndroidViewModel(application) {
    private val repo = application.app.repo
    private val sesion = application.app.sesion
    val esAdmin get() = sesion.actual?.usuario?.esAdmin == true

    var lista by mutableStateOf<List<Abonado>>(emptyList()); private set
    var alertas by mutableStateOf<List<Alerta>>(emptyList()); private set
    var tarifas by mutableStateOf<List<Tarifa>>(emptyList()); private set
    var cargando by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null)
    var mensaje by mutableStateOf<String?>(null)
    var guardando by mutableStateOf(false); private set

    fun cargar() = viewModelScope.launch {
        cargando = true
        try {
            lista = repo.abonados()
            alertas = repo.alertas().alertas
            if (tarifas.isEmpty()) tarifas = repo.tarifas()
            error = null
        } catch (e: ApiException) { error = e.message } finally { cargando = false }
    }

    fun valorMensual(tipo: String) = tarifas.firstOrNull { it.tipoVehiculo == tipo }?.valorMensualidad ?: 0.0

    /** El valor distinto a la tarifa solo lo puede fijar un administrador (lo valida también el servidor). */
    fun inscribir(
        nombre: String, placa: String, tipo: String, documento: String, telefono: String, email: String,
        meses: Int, metodo: String, valor: Double?, autoriza: Boolean, alTerminar: () -> Unit,
    ) = viewModelScope.launch {
        if (!autoriza) { error = "Se requiere la autorización de tratamiento de datos (Ley 1581)."; return@launch }
        guardando = true; error = null
        try {
            val r = repo.inscribirAbonado(nombre, placa, tipo, documento, telefono, email, meses, metodo, if (esAdmin) valor else null, autoriza)
            mensaje = "Abonado inscrito hasta el ${Formato.fecha(r.fechaFin)} · ${Formato.dinero(r.valor)}"
            alTerminar(); cargar()
        } catch (e: ApiException) { error = e.message } finally { guardando = false }
    }

    fun renovar(a: Abonado, meses: Int, metodo: String, valor: Double?, alTerminar: () -> Unit) = viewModelScope.launch {
        guardando = true; error = null
        try {
            val r = repo.renovarAbonado(a.id, meses, metodo, if (esAdmin) valor else null)
            mensaje = "${a.placa} renovado hasta el ${Formato.fecha(r.fechaFin)} · ${Formato.dinero(r.valor)}"
            alTerminar(); cargar()
        } catch (e: ApiException) { error = e.message } finally { guardando = false }
    }
}
