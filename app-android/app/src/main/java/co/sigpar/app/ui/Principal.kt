package co.sigpar.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import co.sigpar.app.data.DatosSesion
import co.sigpar.app.ui.abonados.AbonadosScreen
import co.sigpar.app.ui.abonados.AbonadosViewModel
import co.sigpar.app.ui.caja.CajaScreen
import co.sigpar.app.ui.caja.CajaViewModel
import co.sigpar.app.ui.mas.MasScreen
import co.sigpar.app.ui.operacion.DentroScreen
import co.sigpar.app.ui.operacion.Modo
import co.sigpar.app.ui.operacion.OperacionScreen
import co.sigpar.app.ui.operacion.OperacionViewModel
import co.sigpar.app.ui.recibo.ReciboHoja
import co.sigpar.app.ui.scanner.EscanerPlaca
import co.sigpar.app.ui.theme.Colores

private enum class Pestana(val titulo: String) { OPERACION("Operación"), DENTRO("Dentro"), ABONADOS("Abonados"), CAJA("Caja"), MAS("Más") }

/** Pantalla principal del operador: barra de navegación abajo (vertical) o riel a la izquierda (horizontal). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Principal(s: DatosSesion, sesionVm: SesionViewModel) {
    val op: OperacionViewModel = viewModel(key = "op-${s.sedeId}")
    val abonadosVm: AbonadosViewModel = viewModel(key = "ab-${s.sedeId}")
    val cajaVm: CajaViewModel = viewModel(key = "caja-${s.sedeId}")
    var pestana by rememberSaveable { mutableStateOf(Pestana.OPERACION) }

    // La barra superior es asfalto oscuro en ambos temas: íconos del sistema (hora, batería) en claro.
    val vista = androidx.compose.ui.platform.LocalView.current
    val temaOscuro = androidx.compose.foundation.isSystemInDarkTheme()
    androidx.compose.runtime.DisposableEffect(temaOscuro) {
        val ventana = (vista.context as? android.app.Activity)?.window
        val control = ventana?.let { androidx.core.view.WindowCompat.getInsetsController(it, vista) }
        control?.isAppearanceLightStatusBars = false
        onDispose { control?.isAppearanceLightStatusBars = !temaOscuro }
    }
    var modo by rememberSaveable { mutableStateOf(Modo.ENTRADA) }
    var escaner by rememberSaveable { mutableStateOf<Modo?>(null) }
    // Guía rápida: se muestra sola la primera vez que el operador entra a la app
    val contexto = androidx.compose.ui.platform.LocalContext.current
    // null = cerrada; número = tema donde se abre
    var guia by rememberSaveable { mutableStateOf(if (guiaVista(contexto)) null else 0) }
    val enLinea by sesionVm.enLinea.collectAsStateWithLifecycle()
    val conectando by sesionVm.conectando.collectAsStateWithLifecycle()
    val ciclo = LocalLifecycleOwner.current

    // Tiempo real: mientras la app está en pantalla se consulta cada 5 s (igual que la web). En segundo plano se detiene.
    LaunchedEffect(s.sedeId) { ciclo.repeatOnLifecycle(Lifecycle.State.STARTED) { op.cicloTiempoReal() } }
    LaunchedEffect(s.sedeId) { ciclo.repeatOnLifecycle(Lifecycle.State.STARTED) { op.cicloCotizacion() } }
    LaunchedEffect(Unit) { abonadosVm.cargar() }

    // El mensaje de éxito desaparece solo
    LaunchedEffect(op.mensaje) { if (op.mensaje != null) { kotlinx.coroutines.delay(6000); op.mensaje = null } }

    escaner?.let { m ->
        BackHandler { escaner = null }
        EscanerPlaca(
            onPlaca = { lectura ->
                escaner = null
                if (m == Modo.ENTRADA) op.usarLectura(lectura) else { op.placaSalida = lectura.placa; op.buscarSalida(lectura.placa) }
            },
            onCerrar = { escaner = null },
        )
        return
    }

    // En horizontal (o en pantallas bajas) la altura es lo que escasea: el encabezado va en una línea
    // y la navegación pasa a un riel a la izquierda, así el contenido no queda en una franja.
    val horizontal = androidx.compose.ui.platform.LocalConfiguration.current.screenHeightDp < 480
    val titulo = if (pestana == Pestana.OPERACION) (if (modo == Modo.ENTRADA) "Entrada" else "Salida") else pestana.titulo
    val sedeNombre = s.sedes.firstOrNull { it.id == s.sedeId }?.nombre.orEmpty()
    val iconoDe = { p: Pestana ->
        when (p) {
            Pestana.OPERACION -> Ph.gridNine
            Pestana.DENTRO -> Ph.carProfile
            Pestana.ABONADOS -> Ph.usersThree
            Pestana.CAJA -> Ph.cashRegister
            Pestana.MAS -> Ph.list
        }
    }
    val iconoPestana: @Composable (Pestana) -> Unit = { p ->
        val icono = iconoDe(p)
        when {
            p == Pestana.DENTRO && (op.estado?.activos?.size ?: 0) > 0 -> BadgedBox({ Badge(containerColor = Colores.placa, contentColor = Colores.tinta) { Text("${op.estado?.activos?.size}") } }) { Icon(icono, null) }
            p == Pestana.ABONADOS && abonadosVm.alertas.isNotEmpty() -> BadgedBox({ Badge(containerColor = Colores.reservado) { Text("${abonadosVm.alertas.size}") } }) { Icon(icono, null) }
            else -> Icon(icono, null)
        }
    }

    Scaffold(
        topBar = {
            Column {
                TopAppBar(
                    title = {
                        if (horizontal) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(titulo, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                                Text("  ·  $sedeNombre", fontSize = 13.sp, color = Colores.placa)
                            }
                        } else {
                            Column {
                                Text(titulo, fontWeight = FontWeight.Bold)
                                Text(sedeNombre, fontSize = 12.sp, color = Colores.placa)
                            }
                        }
                    },
                    actions = {
                        // Ayuda siempre a mano: abre la guía en el tema de la pestaña actual
                        androidx.compose.material3.IconButton({
                            guia = when (pestana) {
                                Pestana.OPERACION -> if (modo == Modo.ENTRADA) 1 else 3
                                Pestana.DENTRO -> 3
                                Pestana.CAJA -> 3
                                else -> 0
                            }
                        }) { Icon(Ph.question, "Cómo usar", tint = Color.White) }
                    },
                    expandedHeight = if (horizontal) 48.dp else TopAppBarDefaults.TopAppBarExpandedHeight,
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Colores.barra, titleContentColor = Color.White),
                )
                AvisoConexion(enLinea, conectando)
            }
        },
        bottomBar = {
            if (!horizontal) {
                NavigationBar {
                    Pestana.entries.forEach { p ->
                        NavigationBarItem(
                            selected = pestana == p, onClick = { pestana = p },
                            label = { Text(p.titulo, fontSize = 11.sp) },
                            icon = { iconoPestana(p) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        Row(Modifier.fillMaxSize().padding(padding)) {
            if (horizontal) {
                NavigationRail(Modifier.fillMaxHeight().verticalScroll(rememberScrollState())) {
                    Pestana.entries.forEach { p ->
                        NavigationRailItem(
                            selected = pestana == p, onClick = { pestana = p },
                            label = { Text(p.titulo, fontSize = 11.sp) },
                            icon = { iconoPestana(p) },
                        )
                    }
                }
            }
            // Cambio de pestaña: fundido corto (se usa muchas veces al día, no debe sentirse lento)
            androidx.compose.animation.Crossfade(pestana, Modifier.weight(1f).fillMaxHeight(), androidx.compose.animation.core.tween(160), label = "pestana") { pestanaActual ->
                when (pestanaActual) {
                    Pestana.OPERACION -> OperacionScreen(op, modo, { modo = it }, { escaner = it })
                    Pestana.DENTRO -> DentroScreen(op) { id -> modo = Modo.SALIDA; pestana = Pestana.OPERACION; op.abrirSalida(id) }
                    Pestana.ABONADOS -> AbonadosScreen(abonadosVm)
                    Pestana.CAJA -> CajaScreen(cajaVm)
                    Pestana.MAS -> MasScreen(s, sesionVm::cambiarSede, { guia = it }, { n, f, c, fin -> sesionVm.guardarPerfil(n, f, c, fin) }) { sesionVm.salir() }
                }
            }
        }
    }

    guia?.let { desde -> GuiaRapida(desde) { guia = null } }
    op.recibo?.let { d -> ReciboHoja(d, onCerrar = { op.recibo = null }, irAImpresora = { pestana = Pestana.MAS }) }
}
