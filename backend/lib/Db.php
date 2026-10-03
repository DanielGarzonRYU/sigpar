<?php
/**
 * Conexión PDO única a MySQL. Soporta SSL (obligatorio en Aiven).
 */
final class Db
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo) return self::$pdo;

        $host = Env::get('DB_HOST', '127.0.0.1');
        $port = Env::get('DB_PORT', '3306');
        $name = Env::get('DB_NAME', 'sigpar');
        $dsn  = "mysql:host=$host;port=$port;dbname=$name;charset=utf8mb4";

        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_TIMEOUT            => 10,
            // Conexión persistente: evita repetir el saludo TCP+SSL con Aiven en cada petición
            // (100-300 ms). Cada proceso de Apache reutiliza su conexión.
            PDO::ATTR_PERSISTENT         => Env::bool('DB_PERSISTENT', true),
        ];

        // SSL: DB_SSL_CA puede ser una ruta a ca.pem o el contenido del certificado.
        $ca = Env::get('DB_SSL_CA');
        if ($ca) {
            if (str_contains($ca, 'BEGIN CERTIFICATE')) {
                // Se escribe una sola vez (no en cada petición); el nombre depende del contenido
                $path = sys_get_temp_dir() . '/sigpar-db-ca-' . md5($ca) . '.pem';
                if (!is_file($path)) file_put_contents($path, str_replace('\n', "\n", $ca), LOCK_EX);
                $ca = $path;
            }
            $options[PDO::MYSQL_ATTR_SSL_CA] = $ca;
            $options[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = true;
        }

        self::$pdo = new PDO($dsn, Env::get('DB_USER', 'root'), Env::get('DB_PASS', ''), $options);
        // Una conexión reutilizada nunca debe arrastrar una transacción de una petición anterior
        if (self::$pdo->inTransaction()) self::$pdo->rollBack();
        // Colombia no tiene horario de verano: UTC-5 fijo.
        self::$pdo->exec("SET time_zone = '-05:00'");
        return self::$pdo;
    }

    public static function all(string $sql, array $params = []): array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        return $st->fetchAll();
    }

    public static function one(string $sql, array $params = []): ?array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    public static function value(string $sql, array $params = [])
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        $v = $st->fetchColumn();
        return $v === false ? null : $v;
    }

    public static function exec(string $sql, array $params = []): int
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        return $st->rowCount();
    }

    public static function insert(string $sql, array $params = []): int
    {
        self::exec($sql, $params);
        return (int) self::pdo()->lastInsertId();
    }

    public static function tx(callable $fn)
    {
        $pdo = self::pdo();
        $pdo->beginTransaction();
        try {
            $result = $fn();
            $pdo->commit();
            return $result;
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    /** Genera "?, ?, ?" para cláusulas IN. */
    public static function in(array $values): string
    {
        return implode(',', array_fill(0, max(1, count($values)), '?'));
    }
}
