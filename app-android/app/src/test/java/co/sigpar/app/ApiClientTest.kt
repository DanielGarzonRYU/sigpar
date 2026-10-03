package co.sigpar.app

import co.sigpar.app.data.ApiClient
import co.sigpar.app.data.ApiException
import co.sigpar.app.data.EstadoOperacion
import co.sigpar.app.data.LoginResp
import co.sigpar.app.data.SalidaResp
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.SocketEffect
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit

class ApiClientTest {
    private lateinit var servidor: MockWebServer
    private var esperas = 0
    private lateinit var api: ApiClient

    @Before fun iniciar() {
        servidor = MockWebServer().apply { start() }
        esperas = 0
        api = ApiClient(
            servidor = { servidor.url("/").toString() },
            token = { "tok123" },
            http = OkHttpClient.Builder().readTimeout(2, TimeUnit.SECONDS).build(),
            espera = { esperas++ }, // sin esperas reales en las pruebas
        )
    }

    @After fun terminar() = servidor.close()

    private fun resp(codigo: Int, cuerpo: String) = MockResponse.Builder().code(codigo).body(cuerpo).build()

    @Test fun enviaTokenYLeeNumerosQueLleganComoTexto() = runTest {
        servidor.enqueue(resp(200, """{"ok":true,"espacios":[],"activos":[{"id":7,"sede_id":1,"placa":"ABC123","tipo_vehiculo":"carro",
            "entrada_at":"2026-09-28 10:00:00","estado":"activo","valor_actual":"4500.00","minutos_actuales":"95"}],"servidor_hora":"2026-09-28 11:35:00"}"""))
        val r: EstadoOperacion = api.get("/operacion/estado", "sede_id" to 1)
        assertEquals(4500.0, r.activos.first().valorActual!!, 0.001)
        assertEquals(95, r.activos.first().minutosActuales)
        val req = servidor.takeRequest()
        assertEquals("Bearer tok123", req.headers["Authorization"])
        assertEquals("/api/operacion/estado?sede_id=1", req.target)
    }

    @Test fun consultaSeReintentaMientrasElServidorDespierta() = runTest {
        servidor.enqueue(resp(502, "Bad gateway"))
        servidor.enqueue(resp(503, "Unavailable"))
        servidor.enqueue(resp(200, """{"ok":true,"espacios":[],"activos":[]}"""))
        val r: EstadoOperacion = api.get("/operacion/estado")
        assertTrue(r.espacios.isEmpty())
        assertEquals(3, servidor.requestCount)
        assertEquals(2, esperas)
        assertFalse("El aviso de conexión se apaga al terminar", api.conectando.value)
    }

    @Test fun cobroNoSeReintentaSiSeCortaLaConexion() = runTest {
        // El servidor recibe la petición pero la conexión se corta antes de responder
        servidor.enqueue(MockResponse.Builder().onRequestStart(SocketEffect.CloseSocket()).build())
        try {
            api.post<SalidaResp>("/movimientos/9/salida", JsonObject(emptyMap()))
            fail("Debía fallar")
        } catch (e: ApiException) {
            assertTrue(e.message.contains("no se sabe si la operación se guardó"))
        }
        assertEquals("Un cobro nunca se envía dos veces", 1, servidor.requestCount)
    }

    @Test fun cobroSiSeReintentaSiElServidorConfirmaQueNoLoProceso() = runTest {
        servidor.enqueue(resp(503, "Unavailable"))
        servidor.enqueue(resp(200, """{"ok":true,"cobro":{"minutos":37,"valor":1850,"detalle":"37 min × ${'$'}50 = ${'$'}1.850"},
            "movimiento":{"id":9,"sede_id":1,"placa":"ABC123","tipo_vehiculo":"carro","entrada_at":"2026-09-28 10:00:00","estado":"finalizado"}}"""))
        val r: SalidaResp = api.post("/movimientos/9/salida", JsonObject(emptyMap()))
        assertEquals(1850.0, r.cobro.valor, 0.001)
        assertEquals(2, servidor.requestCount)
    }

    @Test fun errorDeNegocioLlegaConElMensajeDelServidor() = runTest {
        servidor.enqueue(resp(409, """{"ok":false,"error":"El vehículo ABC123 ya está dentro (sede Sede Centro)"}"""))
        try { api.post<JsonObject>("/movimientos/entrada"); fail() } catch (e: ApiException) {
            assertEquals(409, e.status)
            assertEquals("El vehículo ABC123 ya está dentro (sede Sede Centro)", e.message)
        }
    }

    @Test fun sesionVencidaAvisaParaVolverAlLogin() = runTest {
        servidor.enqueue(resp(401, """{"ok":false,"error":"Sesión expirada o inválida"}"""))
        // La pantalla escucha el aviso; debe recibirlo cuando el servidor responde 401
        val recibido = java.util.concurrent.atomic.AtomicBoolean(false)
        backgroundScope.launch(kotlinx.coroutines.test.UnconfinedTestDispatcher(testScheduler)) { api.sesionVencida.first(); recibido.set(true) }
        try { api.get<EstadoOperacion>("/operacion/estado"); fail() } catch (e: ApiException) { assertEquals(401, e.status) }
        testScheduler.advanceUntilIdle()
        assertTrue("La app debe enterarse de que la sesión venció", recibido.get())
    }

    @Test fun loginNoDisparaSesionVencida() = runTest {
        servidor.enqueue(resp(401, """{"ok":false,"error":"Correo o contraseña incorrectos"}"""))
        try { api.post<LoginResp>("/auth/login"); fail() } catch (e: ApiException) { assertEquals("Correo o contraseña incorrectos", e.message) }
    }
}
