package co.sigpar.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Cliente de la API de SIGPAR (la misma que usa la web).
 *
 * Política de reintentos (igual a la web):
 *  - Consultas (GET): si el servidor está "despertando" (Render gratis) o se corta la red, se reintenta
 *    durante ~90 s mostrando "Conectando con el servidor…".
 *  - Operaciones que guardan (POST/PUT/PATCH): se reintentan solo si el servidor respondió 502/503/504
 *    (no procesó nada). Si la conexión se corta a mitad de camino NO se reintentan: podría cobrarse dos veces.
 */
class ApiClient(
    private val servidor: () -> String,
    private val token: () -> String?,
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build(),
    private val espera: suspend (Long) -> Unit = { delay(it) },
) {
    private val enEspera = AtomicInteger(0)
    private val _conectando = MutableStateFlow(false)
    /** true mientras hay peticiones reintentando (se muestra el aviso "Conectando con el servidor…"). */
    val conectando: StateFlow<Boolean> = _conectando.asStateFlow()

    private val _sesionVencida = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    /** Se emite cuando el servidor responde 401: la sesión expiró o el usuario fue desactivado. */
    val sesionVencida: SharedFlow<Unit> = _sesionVencida.asSharedFlow()

    suspend inline fun <reified T> get(ruta: String, vararg params: Pair<String, Any?>): T =
        enviar("GET", ruta, params.toList(), null, serializer())

    suspend inline fun <reified T> post(ruta: String, cuerpo: JsonObject = JsonObject(emptyMap())): T =
        enviar("POST", ruta, emptyList(), cuerpo, serializer())

    suspend inline fun <reified T> patch(ruta: String, cuerpo: JsonObject): T =
        enviar("PATCH", ruta, emptyList(), cuerpo, serializer())

    suspend inline fun <reified T> put(ruta: String, cuerpo: JsonObject): T =
        enviar("PUT", ruta, emptyList(), cuerpo, serializer())

    suspend fun <T> enviar(metodo: String, ruta: String, params: List<Pair<String, Any?>>, cuerpo: JsonObject?, ser: KSerializer<T>): T =
        withContext(Dispatchers.IO) {
            val base = servidor().trimEnd('/')
            val url = ("$base/api$ruta").toHttpUrlOrNull()?.newBuilder()
                ?.apply { params.forEach { (k, v) -> if (v != null && v.toString().isNotEmpty()) addQueryParameter(k, v.toString()) } }
                ?.build() ?: throw ApiException(0, "La dirección del servidor no es válida: $base")

            val idempotente = metodo == "GET"
            var intento = 0
            var avisando = false
            try {
                while (true) {
                    intento++
                    val req = Request.Builder().url(url).method(
                        metodo,
                        cuerpo?.toString()?.toRequestBody("application/json; charset=utf-8".toMediaType())
                            ?: if (metodo == "GET") null else "{}".toRequestBody("application/json".toMediaType()),
                    ).header("Accept", "application/json").apply {
                        token()?.let { header("Authorization", "Bearer $it") }
                    }.build()

                    val resp = try { http.newCall(req).execute() } catch (e: IOException) { null }
                    val transitorio = (resp == null && idempotente) || (resp != null && resp.code in RETRY)
                    if (transitorio && intento < MAX_INTENTOS) {
                        resp?.close()
                        if (!avisando) { avisando = true; if (enEspera.incrementAndGet() > 0) _conectando.value = true }
                        espera(minOf(2000L * intento, 12000L))
                        continue
                    }
                    if (resp == null) {
                        throw ApiException(0,
                            if (idempotente) "No fue posible conectar con el servidor. Revise su conexión a internet."
                            else "Se perdió la conexión y no se sabe si la operación se guardó. Revise el historial antes de repetirla.")
                    }
                    resp.use { r ->
                        val texto = r.body.string()
                        val json = runCatching { JsonSigpar.parseToJsonElement(texto).jsonObject }.getOrNull()
                        if (r.code == 401 && ruta != "/auth/login") _sesionVencida.tryEmit(Unit)
                        val ok = json?.get("ok")?.jsonPrimitive?.content != "false"
                        if (!r.isSuccessful || !ok || json == null) {
                            val msg = json?.get("error")?.jsonPrimitive?.content
                                ?: if (r.code in RETRY) "El servidor no está disponible en este momento. Intente de nuevo." else "Error ${r.code} del servidor"
                            throw ApiException(r.code, msg)
                        }
                        return@withContext JsonSigpar.decodeFromJsonElement(ser, json)
                    }
                }
                @Suppress("UNREACHABLE_CODE") error("inalcanzable")
            } finally {
                if (avisando && enEspera.decrementAndGet() <= 0) { enEspera.set(0); _conectando.value = false }
            }
        }

    companion object {
        private val RETRY = setOf(502, 503, 504)
        const val MAX_INTENTOS = 8 // ~90 s en total: cubre el arranque en frío de Render
    }
}
