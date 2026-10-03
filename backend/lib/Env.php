<?php
/**
 * Carga variables de entorno. En Render vienen del panel; en local, del archivo .env.
 */
final class Env
{
    private static bool $loaded = false;

    public static function load(string $file): void
    {
        if (self::$loaded) return;
        self::$loaded = true;
        if (!is_file($file)) return;

        foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) continue;
            [$key, $value] = array_map('trim', explode('=', $line, 2));
            $value = trim($value, "\"'");
            // Las variables reales del sistema tienen prioridad sobre el .env
            if (getenv($key) === false) {
                putenv("$key=$value");
                $_ENV[$key] = $value;
            }
        }
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        $v = getenv($key);
        return ($v === false || $v === '') ? $default : $v;
    }

    public static function bool(string $key, bool $default = false): bool
    {
        $v = self::get($key);
        if ($v === null) return $default;
        return in_array(strtolower($v), ['1', 'true', 'yes', 'si', 'on'], true);
    }
}
