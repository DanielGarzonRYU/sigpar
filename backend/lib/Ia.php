<?php
/**
 * Lectura de fotos y bocetos de parqueaderos con IA (opcional).
 *
 * Solo funciona si el servidor tiene ANTHROPIC_API_KEY. Sin clave, el editor sigue ofreciendo el asistente
 * por descripción (que funciona sin Internet) y la foto como calco para dibujar encima.
 * La IA devuelve una propuesta; nada se guarda hasta que el administrador la revisa y pulsa Guardar.
 */
final class Ia
{
    private const TIPOS_ELEMENTO = ['via', 'zona', 'muro', 'columna', 'entrada', 'salida', 'caseta', 'texto'];

    public static function configurada(): bool
    {
        return (bool) Env::get('ANTHROPIC_API_KEY');
    }

    /**
     * Pide a la IA el plano de la imagen (y/o la descripción). $conteos: espacios actuales por tipo, como referencia.
     * Devuelve la propuesta ya limpia: ['ancho','alto','elementos','espacios'=>[{tipo,x,y,rot}], 'notas'].
     */
    public static function proponerPlano(?string $imagen, string $texto, array $conteos): array
    {
        $contenido = [];
        if ($imagen !== null) {
            if (!preg_match('#^data:(image/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$#', $imagen, $m)) {
                Http::fail(422, 'La imagen debe ser JPG, PNG o WEBP');
            }
            if (strlen($m[2]) > 6_000_000) Http::fail(422, 'La imagen es muy pesada (máximo 4 MB)');
            $contenido[] = ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $m[1], 'data' => $m[2]]];
        }
        $existentes = sprintf('%d de carro, %d de moto y %d de bicicleta', $conteos['carro'] ?? 0, $conteos['moto'] ?? 0, $conteos['bicicleta'] ?? 0);
        $contenido[] = ['type' => 'text', 'text' => implode("\n", [
            $imagen !== null ? 'La imagen es una foto, un boceto a mano o un plano de un parqueadero en Colombia.' : 'Este es el parqueadero que describe el administrador.',
            $texto !== '' ? "Descripción del administrador: \"$texto\"" : '',
            "Hoy la sede tiene registrados $existentes espacios.",
            'Dibuje su plano en una cuadrícula donde cada celda mide 1,25 m. x crece a la derecha, y crece hacia abajo.',
            'Huella de cada espacio (ancho x largo en celdas): carro 2 x 4, moto 1 x 2, bicicleta 1 x 2. rot = 1 lo acuesta (carro 4 x 2).',
            'Elementos: via (carril de circulación, mínimo 3 celdas de ancho para carros), entrada, salida, zona (área sin parqueo: jardín, rampa, bodega),',
            'muro (paredes, 1 celda de grosor), columna (1 x 1), caseta (caja o punto de pago), texto (letrero corto, con campo texto).',
            'Reglas: ningún espacio puede quedar encima de otro, ni sobre una vía o columna. Cada espacio debe tocar una vía por su lado corto.',
            'Respete la forma y la distribución que se ve (esquinas, zonas irregulares, espacios en diagonal: aproxímelos a la cuadrícula).',
            'Si en la imagen se pueden contar los espacios, dibuje esa cantidad; si no, use la cantidad registrada.',
            'Responda solo con la herramienta plano.',
        ])];

        $esquemaRect = fn(array $extra = []) => ['type' => 'object', 'properties' => [
            'x' => ['type' => 'integer'], 'y' => ['type' => 'integer'], 'w' => ['type' => 'integer'], 'h' => ['type' => 'integer'],
        ] + $extra, 'required' => ['x', 'y', 'w', 'h']];
        $peticion = [
            'model' => Env::get('ANTHROPIC_MODEL', 'claude-sonnet-5-5'),
            'max_tokens' => 12000,
            'tools' => [[
                'name' => 'plano',
                'description' => 'Plano del parqueadero en celdas de 1,25 m',
                'input_schema' => ['type' => 'object', 'required' => ['ancho', 'alto', 'elementos', 'espacios'], 'properties' => [
                    'ancho' => ['type' => 'integer', 'description' => 'Ancho del lote en celdas (8 a 160)'],
                    'alto' => ['type' => 'integer', 'description' => 'Largo del lote en celdas (8 a 160)'],
                    'elementos' => ['type' => 'array', 'items' => $esquemaRect([
                        't' => ['type' => 'string', 'enum' => self::TIPOS_ELEMENTO], 'texto' => ['type' => 'string'],
                    ])],
                    'espacios' => ['type' => 'array', 'items' => ['type' => 'object', 'required' => ['tipo', 'x', 'y', 'rot'], 'properties' => [
                        'tipo' => ['type' => 'string', 'enum' => ['carro', 'moto', 'bicicleta']],
                        'x' => ['type' => 'integer'], 'y' => ['type' => 'integer'], 'rot' => ['type' => 'integer', 'enum' => [0, 1]],
                    ]]],
                    'notas' => ['type' => 'string', 'description' => 'Una frase corta, en español, sobre lo que no se pudo ver bien (opcional)'],
                ]],
            ]],
            'tool_choice' => ['type' => 'tool', 'name' => 'plano'],
            'messages' => [['role' => 'user', 'content' => $contenido]],
        ];

        $ch = curl_init(rtrim(Env::get('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'), '/') . '/v1/messages');
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 100,
            CURLOPT_HTTPHEADER => ['x-api-key: ' . Env::get('ANTHROPIC_API_KEY'), 'anthropic-version: 2023-06-01', 'content-type: application/json'],
            CURLOPT_POSTFIELDS => json_encode($peticion, JSON_UNESCAPED_UNICODE),
        ]);
        $raw = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $r = is_string($raw) ? json_decode($raw, true) : null;
        if ($code !== 200 || !is_array($r)) {
            error_log('SIGPAR IA: respuesta ' . $code . ' ' . substr((string) $raw, 0, 300));
            Http::fail(424, $code === 0 ? 'No se pudo conectar con el servicio de IA. Intente de nuevo.' : 'El servicio de IA no pudo leer la imagen. Intente con otra foto o use el asistente por descripción.');
        }
        foreach ($r['content'] ?? [] as $bloque) {
            if (($bloque['type'] ?? '') === 'tool_use' && is_array($bloque['input'] ?? null)) return self::limpiar($bloque['input']);
        }
        Http::fail(424, 'La IA no devolvió un plano. Intente con otra foto.');
    }

    /** Deja la propuesta dentro de las reglas del editor: lote válido, piezas recortadas, espacios sin encimarse. */
    public static function limpiar(array $p): array
    {
        $ancho = max(8, min(160, (int) ($p['ancho'] ?? 0)));
        $alto = max(8, min(160, (int) ($p['alto'] ?? 0)));
        $elementos = [];
        foreach (array_slice((array) ($p['elementos'] ?? []), 0, 400) as $el) {
            if (!is_array($el) || !in_array($el['t'] ?? '', self::TIPOS_ELEMENTO, true)) continue;
            $x = max(0, (int) ($el['x'] ?? 0)); $y = max(0, (int) ($el['y'] ?? 0));
            if ($x >= $ancho || $y >= $alto) continue;
            $w = max(1, min($ancho - $x, (int) ($el['w'] ?? 1)));
            $h = max(1, min($alto - $y, (int) ($el['h'] ?? 1)));
            $fila = ['t' => $el['t'], 'x' => $x, 'y' => $y, 'w' => $w, 'h' => $h];
            if ($el['t'] === 'columna') { $fila['w'] = 1; $fila['h'] = 1; }
            if ($el['t'] === 'texto') $fila['texto'] = mb_substr(trim((string) ($el['texto'] ?? '')), 0, 40) ?: 'Texto';
            $elementos[] = $fila;
        }
        // Celdas donde no puede haber espacios: columnas y muros
        $ocupadas = [];
        foreach ($elementos as $el) {
            if (!in_array($el['t'], ['columna', 'muro'], true)) continue;
            for ($i = $el['x']; $i < $el['x'] + $el['w']; $i++) for ($j = $el['y']; $j < $el['y'] + $el['h']; $j++) $ocupadas["$i,$j"] = true;
        }
        $espacios = [];
        foreach (array_slice((array) ($p['espacios'] ?? []), 0, 600) as $e) {
            if (!is_array($e)) continue;
            $tipo = Parking::tipo($e['tipo'] ?? null);
            $rot = (int) !empty($e['rot']);
            [$w, $h] = Parking::huella($tipo, $rot);
            $x = (int) ($e['x'] ?? -1); $y = (int) ($e['y'] ?? -1);
            if ($x < 0 || $y < 0 || $x + $w > $ancho || $y + $h > $alto) continue;
            $celdas = [];
            for ($i = $x; $i < $x + $w; $i++) for ($j = $y; $j < $y + $h; $j++) $celdas[] = "$i,$j";
            if (array_filter($celdas, fn($c) => isset($ocupadas[$c]))) continue;
            foreach ($celdas as $c) $ocupadas[$c] = true;
            $espacios[] = ['tipo' => $tipo, 'x' => $x, 'y' => $y, 'rot' => $rot];
        }
        return ['ancho' => $ancho, 'alto' => $alto, 'elementos' => $elementos, 'espacios' => $espacios,
            'notas' => mb_substr(trim((string) ($p['notas'] ?? '')), 0, 200)];
    }
}
