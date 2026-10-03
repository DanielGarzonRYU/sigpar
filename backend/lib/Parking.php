<?php
/**
 * Reglas de negocio del parqueadero: placas, tarifas y configuración.
 */
final class Parking
{
    public const TIPOS = ['carro', 'moto', 'bicicleta'];
    public const METODOS_PAGO = ['efectivo', 'tarjeta', 'transferencia', 'app'];

    /** "abc-123 " → "ABC123" */
    public static function placa(?string $placa): string
    {
        $p = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string) $placa));
        if (strlen($p) < 3 || strlen($p) > 8) Http::fail(422, 'Placa inválida');
        return $p;
    }

    /** Formato colombiano: carro ABC123, moto ABC12D. Solo informativo (bicicletas y placas extranjeras pasan). */
    public static function formatoColombiano(string $placa): bool
    {
        return (bool) preg_match('/^[A-Z]{3}\d{3}$|^[A-Z]{3}\d{2}[A-Z]$/', $placa);
    }

    public static function tipo(?string $tipo): string
    {
        if (!in_array($tipo, self::TIPOS, true)) Http::fail(422, 'Tipo de vehículo inválido');
        return $tipo;
    }

    public static function config(string $clave, ?string $default = null): ?string
    {
        static $cache = null;
        if ($cache === null) {
            $cache = [];
            foreach (Db::all('SELECT clave, valor FROM configuracion') as $r) $cache[$r['clave']] = $r['valor'];
        }
        return $cache[$clave] ?? $default;
    }

    /** Tarifa de una sede y tipo. Se guarda en memoria durante la petición (evita N consultas al listar vehículos). */
    public static function tarifa(int $sedeId, string $tipo): ?array
    {
        static $cache = [];
        $k = "$sedeId|$tipo";
        if (!array_key_exists($k, $cache)) {
            $cache[$k] = Db::one('SELECT * FROM tarifas WHERE sede_id = ? AND tipo_vehiculo = ?', [$sedeId, $tipo]);
        }
        return $cache[$k];
    }

    /**
     * Huella de un espacio en el plano, en celdas [ancho, largo] (1 celda ≈ 1,25 m).
     * Carro 2,5 x 5 m; moto y bicicleta 1,25 x 2,5 m. Acostado (rot = 1) intercambia los lados.
     * La web y la app usan la misma tabla.
     */
    public const PLANO_HUELLA = ['carro' => [2, 4], 'moto' => [1, 2], 'bicicleta' => [1, 2]];

    public static function huella(string $tipo, int $rot): array
    {
        [$w, $h] = self::PLANO_HUELLA[$tipo] ?? [2, 4];
        return $rot ? [$h, $w] : [$w, $h];
    }

    /** Mapa de espacios con el vehículo que ocupa cada uno (usa el índice espacio+estado). */
    public static function mapaEspacios(array $sedes): array
    {
        return Db::all(
            "SELECT e.id, e.sede_id, s.nombre AS sede, e.codigo, e.tipo_vehiculo, e.estado, e.nota, e.plano_x, e.plano_y, e.plano_rot,
                    m.id AS movimiento_id, m.placa, m.entrada_at, COALESCE(m.propietario, a.nombre) AS propietario, m.abonado_id
             FROM espacios e
             JOIN sedes s ON s.id = e.sede_id
             LEFT JOIN movimientos m ON m.espacio_id = e.id AND m.estado = 'activo'
             LEFT JOIN abonados a ON a.id = m.abonado_id
             WHERE e.sede_id IN (" . Db::in($sedes) . ')
             ORDER BY s.nombre, e.tipo_vehiculo, e.codigo',
            $sedes
        );
    }

    /** Abonado vigente para esa placa en esa sede (o null). */
    public static function abonadoVigente(int $sedeId, string $placa, ?string $fecha = null): ?array
    {
        return Db::one(
            'SELECT * FROM abonados WHERE sede_id = ? AND placa = ? AND activo = 1 AND ? BETWEEN fecha_inicio AND fecha_fin',
            [$sedeId, $placa, $fecha ?? date('Y-m-d')]
        );
    }

    public const MODOS = ['minuto', 'fraccion', 'hora'];

    /** Minutos que abarca cada unidad de cobro según el modo. */
    public static function unidadMinutos(array $t): int
    {
        return match ($t['modo_cobro'] ?? 'fraccion') {
            'minuto' => 1,
            'hora'   => 60,
            default  => max(1, (int) $t['fraccion_minutos']),
        };
    }

    /** Valor equivalente por hora (informativo, para comparar tarifas). */
    public static function valorHoraEquivalente(array $t): float
    {
        return round((float) $t['valor_fraccion'] * 60 / self::unidadMinutos($t), 2);
    }

    private static function pesos(float $v): string
    {
        return '$' . number_format($v, 0, ',', '.');
    }

    /**
     * Cálculo automático del cobro (OE2).
     *  - Minutos de gracia: no se cobra.
     *  - Se cobran unidades completas según el modo (minuto, fracción de N min u hora o fracción).
     *  - Tope por día: cada bloque de 24 h no supera el tope, si está definido.
     *  - El total se redondea hacia arriba al múltiplo configurado ($1 = sin redondeo).
     * El "detalle" explica el cálculo y se imprime en el recibo, p. ej. "37 min × $50 = $1.850".
     */
    public static function calcular(string $entrada, string $salida, ?array $tarifa, bool $esAbonado = false): array
    {
        $segundos = max(0, strtotime($salida) - strtotime($entrada));
        $minutos  = max(1, (int) ceil($segundos / 60));

        if ($esAbonado) {
            return ['minutos' => $minutos, 'valor' => 0.0, 'detalle' => 'Abonado con mensualidad vigente'];
        }
        if (!$tarifa) {
            return ['minutos' => $minutos, 'valor' => 0.0, 'detalle' => 'Sin tarifa configurada para este tipo de vehículo'];
        }

        $gracia = (int) $tarifa['minutos_gracia'];
        if ($minutos <= $gracia) {
            return ['minutos' => $minutos, 'valor' => 0.0, 'detalle' => "Dentro de los $gracia minutos de gracia"];
        }

        $modo     = $tarifa['modo_cobro'] ?? 'fraccion';
        $unidad   = self::unidadMinutos($tarifa);
        $precio   = (float) $tarifa['valor_fraccion'];
        $tope     = (float) $tarifa['tope_dia'];
        $redondeo = max(1, (int) self::config('redondeo_cobro', '100'));

        $dias      = intdiv($minutos, 1440);
        $resto     = $minutos % 1440;
        $unidades  = (int) ceil($resto / $unidad);
        $valorResto = $unidades * $precio;
        $valorDia   = ceil(1440 / $unidad) * $precio;
        if ($tope > 0) { $valorResto = min($valorResto, $tope); $valorDia = min($valorDia, $tope); }
        $bruto = $dias * $valorDia + ($resto > 0 ? $valorResto : 0);
        $valor = ceil($bruto / $redondeo) * $redondeo;

        // Explicación legible del cálculo
        $nombre = match ($modo) {
            'minuto' => fn($n) => "$n min",
            'hora'   => fn($n) => $n === 1 ? '1 hora' : "$n horas",
            default  => fn($n) => ($n === 1 ? '1 fracción' : "$n fracciones") . " de $unidad min",
        };
        $partes = [];
        if ($dias > 0) $partes[] = ($dias === 1 ? '1 día' : "$dias días") . ' × ' . self::pesos($valorDia);
        if ($resto > 0) {
            $partes[] = $tope > 0 && $unidades * $precio > $tope
                ? $nombre($unidades) . ' (tope diario ' . self::pesos($tope) . ')'
                : $nombre($unidades) . ' × ' . self::pesos($precio);
        }
        $detalle = implode(' + ', $partes) . ' = ' . self::pesos($bruto);
        if ($valor != $bruto) $detalle .= ' → redondeado ' . self::pesos($valor);

        return ['minutos' => $minutos, 'valor' => (float) $valor, 'detalle' => $detalle];
    }
}
