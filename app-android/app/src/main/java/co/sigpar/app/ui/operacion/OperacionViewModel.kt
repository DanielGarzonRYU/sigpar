package co.sigpar.app.ui.operacion

import android.app.Application
import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import co.sigpar.app.app
import co.sigpar.app.data.Abonado
import co.sigpar.app.data.ApiException
import co.sigpar.app.data.Cotizacion
import co.sigpar.app.data.EntradaResp
import co.sigpar.app.data.Espacio
import co.sigpar.app.data.EstadoOperacion
import co.sigpar.app.data.Movimiento
import co.sigpar.app.data.MovimientoDetalle
import co.sigpar.app.domain.Formato
import co.sigpar.app.domain.Placa
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.LocalDateTime

/**
 * Operación del parqueadero: mapa en tiempo real, entradas, salidas con cobro y recibos.
 * La misma lógica que la pantalla "Entradas y salidas" de la web, contra la misma API.
 */
class OperacionViewModel(application: Application) : AndroidViewModel(application) {
    private val repo = application.app.repo
    val sesion = application.app.sesion

    // ------------------------------------------------------------------ Estado en tiempo real
    var estado by mutableStateOf<EstadoOperacion?>(null); private set
    var errorEstado by mutableStateOf<String?>(null); private set
    private var horaServidor: LocalDateTime? = null
    private var tomadaEn = 0L

    /** Hora actual según el servidor (el reloj del celular puede estar mal). */
    fun ahora(): LocalDateTime =
        horaServidor?.plusSeconds((SystemClock.elapsedRealtime() - tomadaEn) / 1000) ?: LocalDateTime.now()

    /** Plano dibujado por el administrador (null si la sede no tiene). */
    var plano by mutableStateOf<co.sigpar.app.data.Plano?>(null); private set
    private var versionPlano: String? = null

    suspend fun refrescar() {
        try {
            val r = repo.estado()
            // El dibujo del plano solo se descarga cuando el administrador lo cambia
            val version = r.planos[repo.sedeActual.toString()]
            if (version == null) { plano = null; versionPlano = null }
            else if (version != versionPlano) {
                runCatching { repo.plano() }.getOrNull()?.let { plano = it.plano; versionPlano = version }
            }
            estado = r
            Formato.fechaHoraApi(r.servidorHora)?.let { horaServidor = it; tomadaEn = SystemClock.elapsedRealtime() }
            errorEstado = null
            espacioElegido = espacioElegido?.let { sel -> r.espacios.find { it.id == sel.id && it.estado in setOf("disponible", "reservado") } }
        } catch (e: ApiException) { errorEstado = e.message }
    }

    /** Se llama mientras la pantalla está visible: consulta cada 5 s (la web hace lo mismo). */
    suspend fun cicloTiempoReal() {
        while (true) {
            refrescar()
            delay(5_000)
        }
    }

    fun libres(tipo: String) = estado?.espacios?.count { it.tipoVehiculo == tipo && it.estado == "disponible" } ?: 0

    // ------------------------------------------------------------------ Mensajes
    var mensaje by mutableStateOf<String?>(null)
    var error by mutableStateOf<String?>(null)

    // ------------------------------------------------------------------ Entrada
    var placa by mutableStateOf(""); private set
    var tipo by mutableStateOf("carro")
    var espacioElegido by mutableStateOf<Espacio?>(null)
    var propietario by mutableStateOf("")
    var telefono by mutableStateOf("")
    var autoriza by mutableStateOf(false)
    var abonado by mutableStateOf<Abonado?>(null); private set
    var ultimaEntrada by mutableStateOf<Pair<String, EntradaResp>?>(null); private set
    var enviando by mutableStateOf(false); private set
    private var busquedaAbonado: Job? = null

    fun cambiarPlaca(texto: String) {
        placa = Placa.normalizar(texto).take(8)
        // Sugerir el tipo según el formato colombiano (ABC12D → moto)
        Placa.tipoSugerido(placa)?.let { t -> tipo = if (t == Placa.Tipo.MOTO) "moto" else "carro" }
        if (espacioElegido?.tipoVehiculo != tipo) espacioElegido = null
        abonado = null
        busquedaAbonado?.cancel()
        if (placa.length >= 5) busquedaAbonado = viewModelScope.launch {
            delay(400)
            val a = runCatching { repo.abonados(placa) }.getOrNull()?.firstOrNull { it.placa == placa }
            if (a != null && placa == a.placa) {
                abonado = a
                if (a.estado in setOf("vigente", "por_vencer")) {
                    propietario = a.nombre; a.telefono?.let { telefono = it }; autoriza = true
                }
                tipo = a.tipoVehiculo
            }
        }
    }

    fun usarLectura(l: Placa.Lectura) {
        cambiarPlaca(l.placa)
        tipo = if (l.tipo == Placa.Tipo.MOTO) "moto" else "carro"
    }

    fun vehiculoDentro(): Movimiento? = estado?.activos?.firstOrNull { it.placa == placa }

    fun registrarEntrada() = viewModelScope.launch {
        if (placa.length < 3) { error = "Escriba una placa válida"; return@launch }
        enviando = true; error = null
        try {
            val r = repo.entrada(placa, tipo, espacioElegido?.id, propietario, telefono, autoriza)
            ultimaEntrada = placa to r
            mensaje = "Entrada registrada: $placa → espacio ${r.espacio}" + if (r.abonado != null) " (abonado)" else ""
            if (!r.formatoColombiano && tipo != "bicicleta") mensaje += ". Verifique la placa: no tiene formato colombiano."
            limpiarEntrada()
            refrescar()
        } catch (e: ApiException) { error = e.message } finally { enviando = false }
    }

    fun limpiarEntrada() {
        placa = ""; espacioElegido = null; propietario = ""; telefono = ""; autoriza = false; abonado = null
    }

    // ------------------------------------------------------------------ Salida
    var salida by mutableStateOf<Movimiento?>(null); private set
    var cotizacion by mutableStateOf<Cotizacion?>(null); private set
    var metodo by mutableStateOf("efectivo")
    var placaSalida by mutableStateOf("")

    fun buscarSalida(texto: String = placaSalida) = viewModelScope.launch {
        val p = Placa.normalizar(texto)
        if (p.isEmpty()) return@launch
        placaSalida = p; error = null
        try {
            val r = repo.buscarPlaca(p)
            salida = r.movimiento; cotizacion = r.cotizacion; metodo = "efectivo"
        } catch (e: ApiException) { salida = null; cotizacion = null; error = e.message }
    }

    fun abrirSalida(movimientoId: Int) = viewModelScope.launch {
        error = null
        try {
            val d = repo.movimiento(movimientoId)
            salida = d.movimiento; placaSalida = d.movimiento.placa
            cotizacion = repo.cotizar(movimientoId); metodo = "efectivo"
        } catch (e: ApiException) { error = e.message }
    }

    /** Mantiene actualizado el valor a cobrar mientras se muestra (cada 30 s). */
    suspend fun cicloCotizacion() {
        while (true) {
            delay(30_000)
            val s = salida ?: continue
            runCatching { repo.cotizar(s.id) }.onSuccess { cotizacion = it }
        }
    }

    fun cancelarSalida() { salida = null; cotizacion = null; placaSalida = "" }

    fun registrarSalida() = viewModelScope.launch {
        val s = salida ?: return@launch
        enviando = true; error = null
        try {
            val r = repo.salida(s.id, if (cotizacion?.esAbonado == true) "abonado" else metodo)
            mensaje = "Salida registrada: ${s.placa} · ${Formato.dinero(r.cobro.valor)}"
            cancelarSalida()
            verRecibo(s.id)
            refrescar()
        } catch (e: ApiException) { error = e.message } finally { enviando = false }
    }

    // ------------------------------------------------------------------ Espacios
    fun reservar(e: Espacio, nota: String) = cambiarEstado(e, "reservado", nota.ifBlank { null })
    fun liberar(e: Espacio) = cambiarEstado(e, "disponible", null)

    private fun cambiarEstado(e: Espacio, nuevo: String, nota: String?) = viewModelScope.launch {
        try {
            repo.cambiarEstadoEspacio(e.id, nuevo, nota)
            mensaje = "Espacio ${e.codigo}: ${if (nuevo == "reservado") "reservado" else "liberado"}"
            refrescar()
        } catch (ex: ApiException) { error = ex.message }
    }

    fun elegirParaEntrada(e: Espacio) { espacioElegido = e; tipo = e.tipoVehiculo }

    // ------------------------------------------------------------------ Recibo
    var recibo by mutableStateOf<MovimientoDetalle?>(null)

    fun verRecibo(movimientoId: Int) = viewModelScope.launch {
        try { recibo = repo.movimiento(movimientoId) } catch (e: ApiException) { error = e.message }
    }
}
