package co.sigpar.app.data

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonNamingStrategy
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive

/**
 * Configuración JSON de la API de SIGPAR.
 * - Los campos llegan en snake_case ("entrada_at") y en Kotlin se usan en camelCase (entradaAt).
 * - Se ignoran campos nuevos que agregue el servidor (la app no se rompe si la API crece).
 */
@OptIn(ExperimentalSerializationApi::class)
val JsonSigpar = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    namingStrategy = JsonNamingStrategy.SnakeCase
}

/** MySQL devuelve DECIMAL y SUM como texto ("120000.00"): este lector acepta número o texto. */
object FlexDouble : KSerializer<Double> {
    override val descriptor = PrimitiveSerialDescriptor("FlexDouble", PrimitiveKind.DOUBLE)
    override fun serialize(encoder: Encoder, value: Double) = encoder.encodeDouble(value)
    override fun deserialize(decoder: Decoder): Double {
        val p = (decoder as? JsonDecoder)?.decodeJsonElement()?.jsonPrimitive ?: return decoder.decodeDouble()
        return p.content.toDoubleOrNull() ?: 0.0
    }
}

/** Igual que [FlexDouble] para enteros (conteos que a veces llegan como texto). */
object FlexInt : KSerializer<Int> {
    override val descriptor = PrimitiveSerialDescriptor("FlexInt", PrimitiveKind.INT)
    override fun serialize(encoder: Encoder, value: Int) = encoder.encodeInt(value)
    override fun deserialize(decoder: Decoder): Int {
        val p = (decoder as? JsonDecoder)?.decodeJsonElement()?.jsonPrimitive ?: return decoder.decodeInt()
        return p.content.toDoubleOrNull()?.toInt() ?: 0
    }
}

/** Booleanos que MySQL puede enviar como 1/0. */
object FlexBool : KSerializer<Boolean> {
    override val descriptor = PrimitiveSerialDescriptor("FlexBool", PrimitiveKind.BOOLEAN)
    override fun serialize(encoder: Encoder, value: Boolean) = encoder.encodeBoolean(value)
    override fun deserialize(decoder: Decoder): Boolean {
        val p = (decoder as? JsonDecoder)?.decodeJsonElement() as? JsonPrimitive ?: return decoder.decodeBoolean()
        return p.content == "true" || p.content == "1"
    }
}
