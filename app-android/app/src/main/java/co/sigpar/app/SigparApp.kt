package co.sigpar.app

import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import co.sigpar.app.data.ApiClient
import co.sigpar.app.data.Repositorio
import co.sigpar.app.data.Sesion
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Punto de arranque: crea una sola vez la sesión, el cliente de la API y el monitor de internet. */
class SigparApp : Application() {
    lateinit var sesion: Sesion; private set
    lateinit var repo: Repositorio; private set
    lateinit var red: MonitorRed; private set

    override fun onCreate() {
        super.onCreate()
        sesion = Sesion(this)
        val api = ApiClient(servidor = { sesion.servidor }, token = { sesion.actual?.token })
        repo = Repositorio(api, sesion)
        red = MonitorRed(this)
    }
}

val Context.app: SigparApp get() = applicationContext as SigparApp

/** ¿Hay internet? Se usa para mostrar "Sin conexión a internet" en lugar de errores confusos. */
class MonitorRed(ctx: Context) {
    private val _enLinea = MutableStateFlow(true)
    val enLinea: StateFlow<Boolean> = _enLinea

    init {
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        _enLinea.value = cm.getNetworkCapabilities(cm.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { _enLinea.value = true }
            override fun onLost(network: Network) { _enLinea.value = false }
        })
    }
}
