package co.sigpar.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import co.sigpar.app.app
import co.sigpar.app.data.ApiException
import co.sigpar.app.data.DatosSesion
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** Estado general de la app: ¿hay sesión?, ¿qué sede? */
sealed interface Pantalla {
    data object Cargando : Pantalla
    data class Login(val aviso: String? = null) : Pantalla
    data class ElegirSede(val sesion: DatosSesion) : Pantalla
    data class Principal(val sesion: DatosSesion) : Pantalla
}

class SesionViewModel(application: Application) : AndroidViewModel(application) {
    private val sesion = application.app.sesion
    private val repo = application.app.repo

    private val _pantalla = MutableStateFlow<Pantalla>(Pantalla.Cargando)
    val pantalla: StateFlow<Pantalla> = _pantalla

    val servidor get() = sesion.servidor
    val conectando = repo.api.conectando
    val enLinea = application.app.red.enLinea

    init {
        viewModelScope.launch {
            sesion.cargar()
            actualizarPantalla()
            // Refresca rol y sedes desde el servidor (pudieron cambiar desde la web)
            if (sesion.actual != null) runCatching { sesion.refrescar(repo.yo()) }.onSuccess { actualizarPantalla() }
        }
        // Si el servidor responde 401 (sesión vencida o usuario desactivado) se vuelve al inicio de sesión
        viewModelScope.launch {
            repo.api.sesionVencida.collect {
                if (sesion.actual != null) { sesion.cerrar(); _pantalla.value = Pantalla.Login("Su sesión expiró. Ingrese de nuevo.") }
            }
        }
    }

    private fun actualizarPantalla() {
        val s = sesion.actual
        _pantalla.value = when {
            s == null -> Pantalla.Login()
            s.sedes.isEmpty() -> Pantalla.Login("Su usuario no tiene sedes asignadas. Pídale al administrador que le asigne una.")
            s.sedeId == null -> Pantalla.ElegirSede(s)
            else -> Pantalla.Principal(s)
        }
    }

    /** Devuelve null si entró bien, o el mensaje de error. */
    suspend fun ingresar(servidorUrl: String, email: String, clave: String): String? {
        if (email.isBlank() || clave.isBlank()) return "Escriba su correo y contraseña."
        val url = servidorUrl.trim().trimEnd('/')
        if (!url.startsWith("http://") && !url.startsWith("https://")) return "La dirección del servidor debe empezar por http:// o https://"
        sesion.guardarServidor(url)
        return try {
            val r = repo.login(email, clave)
            if (r.sedes.isEmpty() && r.usuario.rol != "superadmin") return "Su usuario no tiene sedes asignadas. Pídale al administrador que le asigne una."
            sesion.iniciar(r)
            actualizarPantalla()
            null
        } catch (e: ApiException) { e.message }
    }

    fun elegirSede(id: Int) = viewModelScope.launch { sesion.elegirSede(id); actualizarPantalla() }

    fun cambiarSede() { sesion.actual?.let { _pantalla.value = Pantalla.ElegirSede(it) } }

    fun salir() = viewModelScope.launch { sesion.cerrar(); _pantalla.value = Pantalla.Login() }

    /** Guarda nombre y foto del perfil; alTerminar recibe null si salió bien o el mensaje de error. */
    fun guardarPerfil(nombre: String, foto: String?, cambioFoto: Boolean, alTerminar: (String?) -> Unit) = viewModelScope.launch {
        try {
            sesion.refrescar(repo.perfil(nombre, foto, cambioFoto))
            actualizarPantalla()
            alTerminar(null)
        } catch (e: ApiException) { alTerminar(e.message) }
    }
}
