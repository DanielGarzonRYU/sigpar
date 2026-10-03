package co.sigpar.app.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Operaciones de SIGPAR que usa la app (todas pasan por la misma API y base de datos que la web). */
class Repositorio(val api: ApiClient, private val sesion: Sesion) {

    private val sedeId get() = sesion.actual?.sedeId

    suspend fun salud(): Health = api.get("/health")

    suspend fun login(email: String, clave: String): LoginResp =
        api.post("/auth/login", buildJsonObject { put("email", email.trim()); put("password", clave); put("origen", "app") })

    suspend fun yo(): MeResp = api.get("/auth/me")

    /** Mi perfil: nombre y, si cambió, la foto (null la quita). Devuelve la sesión actualizada. */
    suspend fun perfil(nombre: String, foto: String?, cambioFoto: Boolean): MeResp =
        api.put("/auth/perfil", buildJsonObject {
            put("nombre", nombre)
            if (cambioFoto) put("foto", foto?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull)
        })

    suspend fun cambiarClave(actual: String, nueva: String): JsonObject =
        api.post("/auth/password", buildJsonObject { put("actual", actual); put("nueva", nueva) })

    /** Mapa de espacios + vehículos dentro en una sola petición (se consulta cada 5 s). */
    suspend fun estado(): EstadoOperacion = api.get("/operacion/estado", "sede_id" to sedeId)

    /** Plano dibujado de la sede (solo se pide cuando cambia su versión). */
    suspend fun plano(): PlanoResp = api.get("/sedes/$sedeId/plano")

    val sedeActual: Int? get() = sedeId

    suspend fun entrada(placa: String, tipo: String, espacioId: Int?, propietario: String, telefono: String, autoriza: Boolean): EntradaResp =
        api.post("/movimientos/entrada", buildJsonObject {
            put("sede_id", sedeId); put("placa", placa); put("tipo_vehiculo", tipo)
            espacioId?.let { put("espacio_id", it) }
            put("propietario", propietario); put("telefono", telefono); put("autoriza_datos", autoriza)
            put("origen", "app")
        })

    suspend fun buscarPlaca(placa: String): BuscarPlacaResp = api.get("/movimientos/buscar-placa", "placa" to placa, "sede_id" to sedeId)

    suspend fun cotizar(movimientoId: Int): Cotizacion = api.get<CotizarResp>("/movimientos/$movimientoId/cotizar").cotizacion

    suspend fun movimiento(id: Int): MovimientoDetalle = api.get("/movimientos/$id")

    suspend fun salida(movimientoId: Int, metodoPago: String): SalidaResp =
        api.post("/movimientos/$movimientoId/salida", buildJsonObject { put("metodo_pago", metodoPago) })

    suspend fun cambiarEstadoEspacio(id: Int, estado: String, nota: String?): JsonObject =
        api.patch("/espacios/$id/estado", buildJsonObject { put("estado", estado); put("nota", nota) })

    suspend fun abonados(q: String? = null): List<Abonado> = api.get<AbonadosResp>("/abonados", "sede_id" to sedeId, "q" to q).abonados

    suspend fun alertas(): AlertasResp = api.get("/abonados/alertas", "sede_id" to sedeId)

    suspend fun tarifas(): List<Tarifa> = api.get<TarifasResp>("/tarifas", "sede_id" to sedeId).tarifas

    suspend fun inscribirAbonado(
        nombre: String, placa: String, tipo: String, documento: String, telefono: String, email: String,
        meses: Int, metodo: String, valor: Double?, autoriza: Boolean,
    ): AbonadoCreadoResp = api.post("/abonados", buildJsonObject {
        put("sede_id", sedeId); put("nombre", nombre); put("placa", placa); put("tipo_vehiculo", tipo)
        put("documento", documento); put("telefono", telefono); put("email", email)
        put("meses", meses); put("metodo_pago", metodo); valor?.let { put("valor", it) }; put("autoriza_datos", autoriza)
    })

    suspend fun renovarAbonado(id: Int, meses: Int, metodo: String, valor: Double?): RenovadoResp =
        api.post("/abonados/$id/renovar", buildJsonObject { put("meses", meses); put("metodo_pago", metodo); valor?.let { put("valor", it) } })

    suspend fun caja(fecha: String): CajaResp = api.get("/reportes/caja", "fecha" to fecha, "sede_id" to sedeId)

    suspend fun politicaDatos(): String = api.get<ConfigResp>("/config").config["politica_datos"].orEmpty()
}
