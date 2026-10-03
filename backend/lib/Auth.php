<?php
/**
 * Autenticación JWT, control de roles y de acceso por sede.
 *
 * Reglas de sede:
 *  - superadmin: todas las sedes.
 *  - admin / operador: solo las sedes asignadas en usuario_sede.
 */
final class Auth
{
    private static ?array $user = null;
    private static ?array $sedes = null;

    public const ROLES = ['superadmin', 'admin', 'operador'];

    public static function secret(): string
    {
        $s = Env::get('JWT_SECRET');
        if (!$s || strlen($s) < 16) {
            Http::fail(500, 'JWT_SECRET no configurado (mínimo 16 caracteres)');
        }
        // La clave de ejemplo es pública (está en .env.example): solo se tolera en el equipo local
        if (str_starts_with($s, 'cambie-esto') && !Http::esLocal()) {
            Http::fail(500, 'JWT_SECRET es la clave de ejemplo: configure una clave propia y aleatoria');
        }
        return $s;
    }

    public static function token(array $user): string
    {
        $hours = (int) Env::get('JWT_HOURS', '12');
        return Jwt::encode([
            'sub' => (int) $user['id'],
            'rol' => $user['rol'],
            'iat' => time(),
            'exp' => time() + $hours * 3600,
        ], self::secret());
    }

    /** Usuario autenticado o error 401. */
    public static function user(): array
    {
        if (self::$user) return self::$user;

        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if (!preg_match('/^Bearer\s+(.+)$/i', $header, $m)) Http::fail(401, 'Sesión requerida');

        $payload = Jwt::decode(trim($m[1]), self::secret());
        if (!$payload) Http::fail(401, 'Sesión expirada o inválida');

        $user = Db::one('SELECT id, nombre, email, rol, activo FROM usuarios WHERE id = ?', [$payload['sub']]);
        if (!$user || !$user['activo']) Http::fail(401, 'Usuario inactivo');

        $user['id'] = (int) $user['id'];
        return self::$user = $user;
    }

    /** Exige uno de los roles indicados. */
    public static function role(string ...$roles): array
    {
        $u = self::user();
        if (!in_array($u['rol'], $roles, true)) Http::fail(403, 'No tiene permisos para esta acción');
        return $u;
    }

    public static function isSuper(): bool
    {
        return self::user()['rol'] === 'superadmin';
    }

    /** IDs de sedes (activas) a las que el usuario tiene acceso. */
    public static function sedeIds(): array
    {
        if (self::$sedes !== null) return self::$sedes;
        $u = self::user();
        if ($u['rol'] === 'superadmin') {
            $rows = Db::all('SELECT id FROM sedes WHERE activa = 1');
        } else {
            $rows = Db::all(
                'SELECT s.id FROM usuario_sede us JOIN sedes s ON s.id = us.sede_id
                 WHERE us.usuario_id = ? AND s.activa = 1',
                [$u['id']]
            );
        }
        return self::$sedes = array_map(fn($r) => (int) $r['id'], $rows);
    }

    /** Verifica acceso a una sede concreta. */
    public static function checkSede($sedeId): int
    {
        $id = (int) $sedeId;
        if (!$id || !in_array($id, self::sedeIds(), true)) Http::fail(403, 'No tiene acceso a esta sede');
        return $id;
    }

    /**
     * Resuelve el filtro de sede de una consulta: si se pide ?sede_id= se valida,
     * si no, se devuelven todas las sedes permitidas.
     */
    public static function sedeFilter($requested = null): array
    {
        if ($requested !== null && $requested !== '' && $requested !== 'all') {
            return [self::checkSede($requested)];
        }
        $ids = self::sedeIds();
        return $ids ?: [0]; // [0] no coincide con ninguna sede: resultados vacíos
    }
}
