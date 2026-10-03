package co.sigpar.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import co.sigpar.app.ui.Arranque
import co.sigpar.app.ui.ElegirSedeScreen
import co.sigpar.app.ui.LoginScreen
import co.sigpar.app.ui.Pantalla
import co.sigpar.app.ui.Principal
import co.sigpar.app.ui.SesionViewModel
import co.sigpar.app.ui.theme.SigparTema

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            SigparTema {
                // La superficie define el color de fondo y de texto del tema (claro u oscuro) para TODAS las
                // pantallas; sin ella, los textos sin color explícito salían negros en modo oscuro.
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    val vm: SesionViewModel = viewModel()
                    val pantalla by vm.pantalla.collectAsStateWithLifecycle()
                    when (val p = pantalla) {
                        Pantalla.Cargando -> Arranque()
                        is Pantalla.Login -> LoginScreen(vm, p.aviso)
                        is Pantalla.ElegirSede -> ElegirSedeScreen(p.sesion, vm::elegirSede) { vm.salir() }
                        is Pantalla.Principal -> Principal(p.sesion, vm)
                    }
                }
            }
        }
    }
}
