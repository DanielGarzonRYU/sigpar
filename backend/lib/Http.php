<?php
/**
 * Utilidades de petición/respuesta JSON.
 */
final class HttpError extends RuntimeException
{
    public function __construct(public int $status, string $message, public array $extra = [])
    {
        parent::__construct($message);
    }
}

final class Http
{
    private static ?array $body = null;

    public static function json($data, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    public static function body(): array
    {
        if (self::$body === null) {
            $raw = file_get_contents('php://input');
            $decoded = $raw ? json_decode($raw, true) : [];
            self::$body = is_array($decoded) ? $decoded : [];
        }
        return self::$body;
    }

    public static function query(string $key, $default = null)
    {
        $v = $_GET[$key] ?? null;
        return ($v === null || $v === '') ? $default : $v;
    }

    /**
     * IP real del cliente. Solo se confía en X-Forwarded-For cuando la conexión viene de un proxy interno
     * (Render), y se toma el ÚLTIMO valor, que es el que agrega el proxy. El primero lo puede inventar el cliente.
     */
    public static function ip(): string
    {
        $remota = $_SERVER['REMOTE_ADDR'] ?? '';
        $fwd = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
        $interna = $remota !== '' && !filter_var($remota, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
        if ($fwd && $interna && !in_array($remota, ['127.0.0.1', '::1'], true)) {
            $partes = array_map('trim', explode(',', $fwd));
            $ultima = end($partes);
            if (filter_var($ultima, FILTER_VALIDATE_IP)) return $ultima;
        }
        return $remota;
    }

    /** true solo si la petición viene del propio equipo (sin pasar por un proxy). */
    public static function esLocal(): bool
    {
        return in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true) && empty($_SERVER['HTTP_X_FORWARDED_FOR']);
    }

    public static function fail(int $status, string $message, array $extra = []): never
    {
        throw new HttpError($status, $message, $extra);
    }

    /** Valida que existan los campos requeridos en el cuerpo. */
    public static function require(array $data, array $fields): void
    {
        $missing = [];
        foreach ($fields as $f) {
            if (!isset($data[$f]) || (is_string($data[$f]) && trim($data[$f]) === '')) $missing[] = $f;
        }
        if ($missing) self::fail(422, 'Faltan datos obligatorios: ' . implode(', ', $missing), ['campos' => $missing]);
    }
}
