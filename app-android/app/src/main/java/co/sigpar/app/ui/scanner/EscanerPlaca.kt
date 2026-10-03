package co.sigpar.app.ui.scanner

import co.sigpar.app.ui.Ph
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import co.sigpar.app.domain.Placa
import co.sigpar.app.domain.VotoPlaca
import co.sigpar.app.ui.PlacaTag
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Lector de placas con la cámara. Todo ocurre dentro del celular (ML Kit, gratis y sin internet):
 * ninguna imagen se guarda ni se envía al servidor.
 *
 * 1. CameraX entrega cuadros de video; se analiza solo el último (el celular no se satura).
 * 2. ML Kit reconoce el texto; se usa solo el que está dentro del recuadro guía.
 * 3. [Placa.candidatos] valida el formato colombiano y corrige errores típicos.
 * 4. [VotoPlaca] exige la misma placa en varios cuadros antes de proponerla.
 * 5. El operador confirma ("Usar esta placa") o sigue leyendo; siempre puede escribirla a mano.
 */
@Composable
fun EscanerPlaca(onPlaca: (Placa.Lectura) -> Unit, onCerrar: () -> Unit) {
    val ctx = LocalContext.current
    var permitido by remember { mutableStateOf(ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var negado by remember { mutableStateOf(false) }
    val pedir = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> permitido = ok; negado = !ok }
    LaunchedEffect(Unit) { if (!permitido) pedir.launch(Manifest.permission.CAMERA) }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (permitido) VistaCamara(onPlaca, onCerrar)
        else Column(
            Modifier.fillMaxSize().padding(24.dp).safeDrawingPadding(),
            verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                if (negado) "Sin permiso de cámara no se puede leer la placa. Puede escribirla a mano o dar el permiso en Ajustes."
                else "Pidiendo permiso para usar la cámara…",
                color = Color.White, fontSize = 16.sp,
            )
            if (negado) {
                Button(onClick = { pedir.launch(Manifest.permission.CAMERA) }, modifier = Modifier.padding(top = 16.dp)) { Text("Dar permiso") }
                OutlinedButton(onClick = onCerrar, modifier = Modifier.padding(top = 8.dp)) { Text("Escribir a mano", color = Color.White) }
            }
        }
    }
}

@Composable
private fun VistaCamara(onPlaca: (Placa.Lectura) -> Unit, onCerrar: () -> Unit) {
    val ctx = LocalContext.current
    val ciclo = LocalLifecycleOwner.current
    var camara by remember { mutableStateOf<Camera?>(null) }
    var linterna by remember { mutableStateOf(false) }
    var viendo by remember { mutableStateOf<String?>(null) }          // lectura del cuadro actual (informativa)
    var confirmada by remember { mutableStateOf<Placa.Lectura?>(null) } // placa estable, pendiente de confirmar
    val voto = remember { VotoPlaca(ventana = 8, minimo = 3) }
    val pausado = remember { AtomicBoolean(false) }
    val reconocedor = remember { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }
    val hilo = remember { Executors.newSingleThreadExecutor() }

    DisposableEffect(Unit) {
        onDispose { reconocedor.close(); hilo.shutdown() }
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { c ->
            val vista = PreviewView(c).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
            val futuro = ProcessCameraProvider.getInstance(c)
            futuro.addListener({
                val proveedor = futuro.get()
                val preview = Preview.Builder().build().also { it.surfaceProvider = vista.surfaceProvider }
                val analisis = ImageAnalysis.Builder()
                    .setResolutionSelector(ResolutionSelector.Builder().setResolutionStrategy(
                        ResolutionStrategy(android.util.Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER)).build())
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analisis.setAnalyzer(hilo) { imagen -> analizar(imagen, reconocedor, pausado) { lectura, texto ->
                    viendo = texto
                    if (confirmada == null) voto.registrar(lectura)?.let { ok ->
                        confirmada = ok
                        pausado.set(true)
                        vibrar(c)
                    }
                } }
                runCatching {
                    proveedor.unbindAll()
                    camara = proveedor.bindToLifecycle(ciclo, CameraSelector.DEFAULT_BACK_CAMERA, preview, analisis)
                }
            }, ContextCompat.getMainExecutor(c))
            vista
        },
    )

    // Recuadro guía: se oscurece todo lo demás
    Canvas(Modifier.fillMaxSize().graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)) {
        val ancho = size.width * GUIA_ANCHO
        val alto = ancho * 0.42f
        val origen = Offset((size.width - ancho) / 2, (size.height - alto) / 2)
        drawRect(Color.Black.copy(alpha = 0.55f))
        drawRoundRect(Color.Transparent, origen, Size(ancho, alto), CornerRadius(18f), blendMode = BlendMode.Clear)
        drawRoundRect(if (confirmada != null) Color(0xFF16A34A) else Color.White, origen, Size(ancho, alto), CornerRadius(18f), style = Stroke(5f))
    }

    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onCerrar, modifier = Modifier.background(Color.Black.copy(0.5f), RoundedCornerShape(50))) {
                Icon(Ph.x, "Cerrar", tint = Color.White)
            }
            IconButton(
                onClick = { linterna = !linterna; camara?.cameraControl?.enableTorch(linterna) },
                modifier = Modifier.background(Color.Black.copy(0.5f), RoundedCornerShape(50)),
            ) { Icon(Ph.flashlight, if (linterna) "Apagar linterna" else "Encender linterna", tint = if (linterna) co.sigpar.app.ui.theme.Colores.placa else Color.White) }
        }
        Text(
            "Ubique la placa dentro del recuadro",
            color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 16.sp,
            modifier = Modifier.fillMaxWidth().padding(top = 24.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        Box(Modifier.weight(1f))
        Column(
            Modifier.fillMaxWidth().background(Color.Black.copy(alpha = 0.7f), RoundedCornerShape(16.dp)).padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            val c = confirmada
            if (c == null) {
                Text(viendo?.let { "Leyendo: $it" } ?: "Buscando una placa…", color = Color.White.copy(alpha = 0.85f))
                OutlinedButton(onClick = onCerrar) { Text("Escribir a mano", color = Color.White) }
            } else {
                Text("Placa detectada", color = Color.White)
                PlacaTag(c.placa, grande = true)
                Text(if (c.tipo == Placa.Tipo.MOTO) "Formato de moto" else "Formato de carro", color = Color.White.copy(alpha = 0.8f), fontSize = 13.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(onClick = { confirmada = null; voto.reiniciar(); pausado.set(false) }) { Text("Leer otra vez", color = Color.White) }
                    Button(onClick = { onPlaca(c) }) { Text("Usar esta placa") }
                }
            }
        }
    }
}

/** Parte del cuadro que ocupa el recuadro guía (a lo ancho y a lo alto de la imagen). */
private const val GUIA_ANCHO = 0.84f

@androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
private fun analizar(
    imagen: ImageProxy,
    reconocedor: com.google.mlkit.vision.text.TextRecognizer,
    pausado: AtomicBoolean,
    alTerminar: (Placa.Lectura?, String?) -> Unit,
) {
    val media = imagen.image
    if (media == null || pausado.get()) { imagen.close(); return }
    val rot = imagen.imageInfo.rotationDegrees
    val entrada = InputImage.fromMediaImage(media, rot)
    // Dimensiones de la imagen ya "derecha" (ML Kit entrega las cajas en ese sistema)
    val ancho = if (rot % 180 == 0) imagen.width else imagen.height
    val alto = if (rot % 180 == 0) imagen.height else imagen.width
    reconocedor.process(entrada)
        .addOnSuccessListener { texto ->
            // Solo texto dentro de la franja central (la guía) y de mayor a menor tamaño: la placa suele ser lo más grande
            val lineas = texto.textBlocks.flatMap { it.lines }
                .filter { l ->
                    val b = l.boundingBox ?: return@filter false
                    val cx = b.centerX().toFloat() / ancho; val cy = b.centerY().toFloat() / alto
                    cx in (0.5f - GUIA_ANCHO / 2)..(0.5f + GUIA_ANCHO / 2) && cy in 0.25f..0.75f
                }
                .sortedByDescending { it.boundingBox?.height() ?: 0 }
            val candidatos = Placa.candidatos(lineas.map { it.text })
            alTerminar(candidatos.firstOrNull(), lineas.firstOrNull()?.text)
        }
        .addOnFailureListener { alTerminar(null, null) }
        .addOnCompleteListener { imagen.close() }
}

private fun vibrar(ctx: android.content.Context) {
    val v = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
        ctx.getSystemService(android.os.VibratorManager::class.java)?.defaultVibrator
    else @Suppress("DEPRECATION") ctx.getSystemService(Vibrator::class.java)
    v?.vibrate(VibrationEffect.createOneShot(60, VibrationEffect.DEFAULT_AMPLITUDE))
}
