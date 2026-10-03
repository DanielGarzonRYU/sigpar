@file:UseSerializers(FlexDouble::class, FlexInt::class, FlexBool::class)

package co.sigpar.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.UseSerializers

/*
 * Modelos de la API REST de SIGPAR (la misma que usa la web; ver docs/API.md).
 * Los nombres en camelCase se convierten solos a snake_case (ver JsonSigpar).
 */

@Serializable data class Usuario(val id: Int, val nombre: String, val email: String, val rol: String, val foto: String? = null) {
    val esAdmin get() = rol == "superadmin" || rol == "admin"
}

@Serializable data class Sede(val id: Int, val nombre: String)

@Serializable data class LoginResp(val token: String, val usuario: Usuario, val sedes: List<Sede> = emptyList(), val empresa: String? = null)

@Serializable data class MeResp(val usuario: Usuario, val sedes: List<Sede> = emptyList(), val empresa: String? = null)

@Serializable data class Health(val ok: Boolean = false, val demo: Boolean = false, val hora: String? = null)

@Serializable data class Espacio(
    val id: Int,
    val sedeId: Int,
    val sede: String? = null,
    val codigo: String,
    val tipoVehiculo: String,
    val estado: String,
    val nota: String? = null,
    val movimientoId: Int? = null,
    val placa: String? = null,
    val entradaAt: String? = null,
    val propietario: String? = null,
    val abonadoId: Int? = null,
    // Ubicación en el plano dibujado por el administrador (null = sin ubicar)
    val planoX: Int? = null,
    val planoY: Int? = null,
    val planoRot: Int = 0,
)

@Serializable data class Movimiento(
    val id: Int,
    val sedeId: Int,
    val espacioId: Int? = null,
    val placa: String,
    val tipoVehiculo: String,
    val propietario: String? = null,
    val telefono: String? = null,
    val abonadoId: Int? = null,
    val entradaAt: String,
    val salidaAt: String? = null,
    val minutos: Int? = null,
    val valor: Double? = null,
    val detalleCobro: String? = null,
    val metodoPago: String? = null,
    val estado: String,
    val origen: String? = null,
    val observacion: String? = null,
    val sede: String? = null,
    val espacio: String? = null,
    val usuarioEntrada: String? = null,
    val usuarioSalida: String? = null,
    val abonado: String? = null,
    val minutosActuales: Int? = null,
    val valorActual: Double? = null,
)

@Serializable data class EstadoOperacion(
    val espacios: List<Espacio> = emptyList(),
    val activos: List<Movimiento> = emptyList(),
    /** Versión (fecha) del plano de cada sede: el dibujo se descarga solo cuando cambia. */
    val planos: Map<String, String?> = emptyMap(),
    val servidorHora: String? = null,
)

/** Plano del parqueadero, en celdas de 1,25 m (ver PlanoVivo). */
@Serializable data class Plano(val ancho: Int, val alto: Int, val elementos: List<PiezaPlano> = emptyList())
@Serializable data class PiezaPlano(val t: String, val x: Int, val y: Int, val w: Int = 1, val h: Int = 1, val texto: String? = null)
@Serializable data class PlanoResp(val plano: Plano? = null, val planoAt: String? = null)

@Serializable data class Cotizacion(
    val minutos: Int,
    val valor: Double,
    val detalle: String,
    val salidaAt: String? = null,
    val esAbonado: Boolean = false,
)

@Serializable data class BuscarPlacaResp(val movimiento: Movimiento, val cotizacion: Cotizacion)
@Serializable data class CotizarResp(val cotizacion: Cotizacion)
@Serializable data class EntradaResp(val id: Int, val espacio: String, val abonado: String? = null, val formatoColombiano: Boolean = true)

@Serializable data class Cobro(val minutos: Int, val valor: Double, val detalle: String, val metodoPago: String? = null, val placa: String? = null)
@Serializable data class SalidaResp(val cobro: Cobro, val movimiento: Movimiento)

@Serializable data class SedeInfo(val nombre: String, val direccion: String? = null, val telefono: String? = null)
@Serializable data class EmpresaInfo(val nombre: String? = null, val nit: String? = null)
@Serializable data class MovimientoDetalle(val movimiento: Movimiento, val sede: SedeInfo, val empresa: EmpresaInfo = EmpresaInfo())

@Serializable data class Abonado(
    val id: Int,
    val sedeId: Int,
    val sede: String? = null,
    val nombre: String,
    val documento: String? = null,
    val telefono: String? = null,
    val email: String? = null,
    val placa: String,
    val tipoVehiculo: String,
    val fechaInicio: String,
    val fechaFin: String,
    val activo: Int = 1,
    val estado: String? = null,
    val diasRestantes: Int? = null,
)
@Serializable data class AbonadosResp(val abonados: List<Abonado> = emptyList())
@Serializable data class AbonadoCreadoResp(val id: Int, val fechaFin: String, val valor: Double)
@Serializable data class RenovadoResp(val fechaFin: String, val valor: Double)

@Serializable data class Alerta(
    val id: Int, val nombre: String, val placa: String, val telefono: String? = null, val email: String? = null,
    val fechaFin: String, val sedeId: Int, val sede: String, val diasRestantes: Int,
)
@Serializable data class AlertasResp(val alertas: List<Alerta> = emptyList(), val diasAlerta: Int = 5)

@Serializable data class Tarifa(
    val sedeId: Int, val tipoVehiculo: String, val modoCobro: String = "fraccion", val valorFraccion: Double = 0.0,
    val fraccionMinutos: Int = 15, val minutosGracia: Int = 0, val topeDia: Double = 0.0, val valorMensualidad: Double = 0.0,
)
@Serializable data class TarifasResp(val tarifas: List<Tarifa> = emptyList())

@Serializable data class CajaFila(val usuario: String, val sede: String, val metodo: String, val cantidad: Int, val total: Double)
@Serializable data class CajaResp(val fecha: String, val resumen: List<CajaFila> = emptyList(), val total: Double = 0.0, val efectivo: Double = 0.0)

@Serializable data class ConfigResp(val config: Map<String, String?> = emptyMap())

/** Error de negocio o de conexión con un mensaje listo para mostrar al operador. */
class ApiException(val status: Int, override val message: String) : Exception(message)
