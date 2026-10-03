package co.sigpar.app.printing

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.UUID

/**
 * Impresión en impresoras térmicas Bluetooth (perfil serial SPP). La impresora se vincula una vez
 * desde los ajustes de Bluetooth del celular y luego se elige en SIGPAR → Más → Impresora.
 */
object ImpresoraBluetooth {
    private val SPP: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    data class Dispositivo(val nombre: String, val mac: String)

    /** Permiso que hay que pedir antes de usar Bluetooth (Android 12+). */
    val permiso: String? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Manifest.permission.BLUETOOTH_CONNECT else null

    fun tienePermiso(ctx: Context): Boolean =
        permiso == null || ContextCompat.checkSelfPermission(ctx, permiso) == PackageManager.PERMISSION_GRANTED

    fun disponible(ctx: Context): Boolean = ctx.getSystemService(BluetoothManager::class.java)?.adapter != null

    @SuppressLint("MissingPermission") // se verifica con tienePermiso() antes de llamar
    fun vinculados(ctx: Context): List<Dispositivo> {
        if (!tienePermiso(ctx)) return emptyList()
        val adapter = ctx.getSystemService(BluetoothManager::class.java)?.adapter ?: return emptyList()
        if (!adapter.isEnabled) throw IllegalStateException("El Bluetooth está apagado. Enciéndalo e intente de nuevo.")
        return adapter.bondedDevices.orEmpty()
            .map { Dispositivo(it.name ?: it.address, it.address) }
            .sortedBy { it.nombre }
    }

    @SuppressLint("MissingPermission")
    suspend fun imprimir(ctx: Context, mac: String, datos: ByteArray) = withContext(Dispatchers.IO) {
        if (!tienePermiso(ctx)) throw IllegalStateException("Falta el permiso de Bluetooth")
        val adapter = ctx.getSystemService(BluetoothManager::class.java)?.adapter
            ?: throw IllegalStateException("Este celular no tiene Bluetooth")
        if (!adapter.isEnabled) throw IllegalStateException("El Bluetooth está apagado. Enciéndalo e intente de nuevo.")
        adapter.cancelDiscovery()
        val socket = adapter.getRemoteDevice(mac).createRfcommSocketToServiceRecord(SPP)
        try {
            socket.connect() // bloqueante; Android lo corta solo (~12 s) si la impresora no responde
            socket.outputStream.apply { write(datos); flush() }
            Thread.sleep(400) // da tiempo a que la impresora reciba todo antes de cerrar
        } catch (e: Exception) {
            throw IllegalStateException("No se pudo imprimir. Verifique que la impresora esté encendida, cerca y con papel.", e)
        } finally {
            runCatching { socket.close() }
        }
    }
}
