package co.sigpar.app.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import co.sigpar.app.BuildConfig
import kotlinx.coroutines.flow.first
import kotlinx.serialization.builtins.ListSerializer
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private val Context.almacen by preferencesDataStore(name = "sigpar")

/** Datos de la sesión abierta en el celular. */
data class DatosSesion(
    val token: String,
    val usuario: Usuario,
    val sedes: List<Sede>,
    val empresa: String?,
    val sedeId: Int?,
)

/** Impresora térmica Bluetooth elegida por el operador. */
data class Impresora(val mac: String, val nombre: String, val columnas: Int)

/**
 * Guarda la sesión en el celular. El token se cifra con una llave del Android Keystore
 * (no se puede extraer del dispositivo), de modo que otra app o una copia del almacenamiento no lo pueden usar.
 */
class Sesion(private val context: Context) {

    private object K {
        val servidor = stringPreferencesKey("servidor")
        val token = stringPreferencesKey("token_cifrado")
        val usuario = stringPreferencesKey("usuario")
        val sedes = stringPreferencesKey("sedes")
        val empresa = stringPreferencesKey("empresa")
        val sedeId = intPreferencesKey("sede_id")
        val impresoraMac = stringPreferencesKey("impresora_mac")
        val impresoraNombre = stringPreferencesKey("impresora_nombre")
        val impresoraCols = intPreferencesKey("impresora_columnas")
    }

    // Copia en memoria para que el cliente de la API la lea sin esperar al disco
    @Volatile var servidor: String = BuildConfig.SERVIDOR_POR_DEFECTO; private set
    @Volatile var actual: DatosSesion? = null; private set
    @Volatile var impresora: Impresora? = null; private set

    suspend fun cargar() {
        val p = context.almacen.data.first()
        servidor = p[K.servidor] ?: BuildConfig.SERVIDOR_POR_DEFECTO
        impresora = p[K.impresoraMac]?.let { Impresora(it, p[K.impresoraNombre] ?: it, p[K.impresoraCols] ?: 32) }
        actual = runCatching {
            val token = descifrar(p[K.token] ?: return@runCatching null)
            DatosSesion(
                token = token,
                usuario = JsonSigpar.decodeFromString(Usuario.serializer(), p[K.usuario]!!),
                sedes = JsonSigpar.decodeFromString(ListSerializer(Sede.serializer()), p[K.sedes] ?: "[]"),
                empresa = p[K.empresa],
                sedeId = p[K.sedeId],
            )
        }.getOrNull()
    }

    suspend fun guardarServidor(url: String) {
        servidor = url.trim().trimEnd('/')
        context.almacen.edit { it[K.servidor] = servidor }
    }

    suspend fun iniciar(r: LoginResp) {
        // Si solo tiene una sede, queda elegida; si tiene varias, se conserva la anterior si sigue siendo válida
        val previa = actual?.sedeId?.takeIf { id -> r.sedes.any { it.id == id } }
        val sede = previa ?: r.sedes.singleOrNull()?.id
        actual = DatosSesion(r.token, r.usuario, r.sedes, r.empresa, sede)
        context.almacen.edit {
            it[K.token] = cifrar(r.token)
            it[K.usuario] = JsonSigpar.encodeToString(Usuario.serializer(), r.usuario)
            it[K.sedes] = JsonSigpar.encodeToString(ListSerializer(Sede.serializer()), r.sedes)
            r.empresa?.let { e -> it[K.empresa] = e }
            if (sede != null) it[K.sedeId] = sede else it.remove(K.sedeId)
        }
    }

    /** Actualiza usuario y sedes desde /auth/me (pudieron cambiar desde la web). */
    suspend fun refrescar(me: MeResp) {
        val a = actual ?: return
        val sede = a.sedeId?.takeIf { id -> me.sedes.any { it.id == id } } ?: me.sedes.singleOrNull()?.id
        actual = a.copy(usuario = me.usuario, sedes = me.sedes, empresa = me.empresa, sedeId = sede)
        context.almacen.edit {
            it[K.usuario] = JsonSigpar.encodeToString(Usuario.serializer(), me.usuario)
            it[K.sedes] = JsonSigpar.encodeToString(ListSerializer(Sede.serializer()), me.sedes)
            if (sede != null) it[K.sedeId] = sede else it.remove(K.sedeId)
        }
    }

    suspend fun elegirSede(id: Int) {
        actual = actual?.copy(sedeId = id)
        context.almacen.edit { it[K.sedeId] = id }
    }

    suspend fun guardarImpresora(i: Impresora?) {
        impresora = i
        context.almacen.edit {
            if (i == null) { it.remove(K.impresoraMac); it.remove(K.impresoraNombre); it.remove(K.impresoraCols) }
            else { it[K.impresoraMac] = i.mac; it[K.impresoraNombre] = i.nombre; it[K.impresoraCols] = i.columnas }
        }
    }

    suspend fun cerrar() {
        actual = null
        context.almacen.edit { it.remove(K.token); it.remove(K.usuario); it.remove(K.sedes) }
    }

    // ------------------------------------------------------------------ Cifrado con Android Keystore
    private fun llave(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return gen.generateKey()
    }

    private fun cifrar(texto: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, llave()) }
        return Base64.encodeToString(c.iv + c.doFinal(texto.toByteArray()), Base64.NO_WRAP)
    }

    private fun descifrar(b64: String): String {
        val datos = Base64.decode(b64, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, llave(), GCMParameterSpec(128, datos, 0, 12))
        return String(c.doFinal(datos, 12, datos.size - 12))
    }

    private companion object { const val ALIAS = "sigpar_token" }
}
