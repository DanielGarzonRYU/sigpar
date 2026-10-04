<?php
/**
 * Prepara la base de datos sola al arrancar (igual que migrate.js en KAF):
 *  1. Ejecuta schema.sql (idempotente).
 *  2. Crea el superadministrador inicial si no hay usuarios.
 *  3. Opcional (DEMO_DATA=true): carga sedes y datos de ejemplo.
 * Se ejecuta una vez por arranque del servidor gracias a un archivo bandera.
 */
final class Migrator
{
    public static function runIfNeeded(): void
    {
        $schema = __DIR__ . '/../database/schema.sql';
        // Se ejecuta en cada petición: solo usa datos baratos (fecha y tamaño del archivo), no lo lee.
        $flag = sys_get_temp_dir() . '/sigpar-migrated-' . md5(filemtime($schema) . filesize($schema) . Env::get('DB_HOST', '') . Env::get('DB_NAME', ''));
        if (is_file($flag)) return;

        // La primera vez crea las tablas (y los datos de demostración): puede tardar más que una petición normal
        @set_time_limit(0);
        $lock = fopen($flag . '.lock', 'c');
        flock($lock, LOCK_EX);
        try {
            if (is_file($flag)) return;
            self::run($schema);
            touch($flag);
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    public static function run(string $schemaFile): void
    {
        $sql = file_get_contents($schemaFile);
        $sql = preg_replace('/^\s*--.*$/m', '', $sql);
        foreach (preg_split('/;\s*$/m', $sql) as $stmt) {
            if (trim($stmt) !== '') Db::pdo()->exec($stmt);
        }
        self::upgrades();

        if ((int) Db::value('SELECT COUNT(*) FROM usuarios') === 0) {
            $email = Env::get('ADMIN_EMAIL', 'admin@sigpar.co');
            $pass  = Env::get('ADMIN_PASSWORD');
            if (!$pass) {
                if (Env::bool('DEMO_DATA')) {
                    $pass = 'Sigpar2026*'; // solo en modo demostración (la clave aparece en el README)
                } else {
                    // Producción sin ADMIN_PASSWORD: clave aleatoria, visible solo en los registros (logs) del servidor
                    $pass = bin2hex(random_bytes(8));
                    error_log("[SIGPAR] ADMIN_PASSWORD no estaba configurada. Clave inicial del superadministrador $email: $pass");
                }
            }
            Db::exec(
                "INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?,?,?, 'superadmin')",
                ['Superadministrador', strtolower($email), password_hash($pass, PASSWORD_DEFAULT)]
            );
        }

        // Recuperación: si el superadministrador olvidó su clave, en Render se pone ADMIN_RESET=true,
        // se reinicia el servicio (la clave vuelve a ADMIN_PASSWORD) y luego se quita la variable.
        if (Env::bool('ADMIN_RESET') && Env::get('ADMIN_EMAIL') && Env::get('ADMIN_PASSWORD')) {
            Db::exec(
                "UPDATE usuarios SET password_hash = ?, activo = 1 WHERE email = ? AND rol = 'superadmin'",
                [password_hash(Env::get('ADMIN_PASSWORD'), PASSWORD_DEFAULT), strtolower(Env::get('ADMIN_EMAIL'))]
            );
        }

        if (Env::bool('DEMO_DATA')) {
            require_once __DIR__ . '/../database/demo.php';
            if (DemoData::incompleta()) DemoData::limpiarIncompleta();
            if ((int) Db::value('SELECT COUNT(*) FROM sedes') === 0) DemoData::seed();
        }
    }

    /**
     * Cambios de estructura para bases creadas con versiones anteriores.
     * (MySQL 8 no soporta "ADD COLUMN IF NOT EXISTS", por eso se consulta information_schema.)
     */
    private static function upgrades(): void
    {
        $tiene = fn(string $tabla, string $col): bool => (bool) Db::value(
            'SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
            [$tabla, $col]
        );

        // v1.1: modo de cobro (por minuto / fracción / hora)
        if (!$tiene('tarifas', 'modo_cobro')) {
            Db::pdo()->exec("ALTER TABLE tarifas
                ADD COLUMN modo_cobro ENUM('minuto','fraccion','hora') NOT NULL DEFAULT 'fraccion' AFTER tipo_vehiculo,
                ADD COLUMN valor_fraccion DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER modo_cobro");
            // Las tarifas existentes conservan exactamente el mismo cobro
            Db::pdo()->exec('UPDATE tarifas SET valor_fraccion = ROUND(valor_hora * fraccion_minutos / 60, 2)');
        }
        if (!$tiene('movimientos', 'detalle_cobro')) {
            Db::pdo()->exec('ALTER TABLE movimientos ADD COLUMN detalle_cobro VARCHAR(255) NULL AFTER valor');
        }

        // v1.3: plano del parqueadero (el administrador dibuja la forma real de su lote)
        if (!$tiene('sedes', 'plano')) {
            Db::pdo()->exec('ALTER TABLE sedes ADD COLUMN plano MEDIUMTEXT NULL AFTER activa, ADD COLUMN plano_at DATETIME NULL AFTER plano');
        }
        if (!$tiene('espacios', 'plano_x')) {
            Db::pdo()->exec('ALTER TABLE espacios ADD COLUMN plano_x SMALLINT NULL AFTER nota, ADD COLUMN plano_y SMALLINT NULL AFTER plano_x,
                ADD COLUMN plano_rot TINYINT NOT NULL DEFAULT 0 AFTER plano_y');
        }
        // v1.5: foto de perfil de cada usuario
        if (!$tiene('usuarios', 'foto')) {
            Db::pdo()->exec('ALTER TABLE usuarios ADD COLUMN foto MEDIUMTEXT NULL AFTER ultimo_acceso');
        }
        // v1.4: foto o boceto de calco para dibujar el plano encima
        if (!$tiene('sedes', 'plano_fondo')) {
            Db::pdo()->exec('ALTER TABLE sedes ADD COLUMN plano_fondo MEDIUMTEXT NULL AFTER plano_at');
        }

        // v1.2: índices para que el tiempo real no se vuelva lento cuando crece el historial
        // (estado, sede_id) y no (sede_id, estado): con sede primero MySQL lo elegía por error en los reportes por fecha.
        $existeViejo = (int) Db::value("SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'movimientos' AND INDEX_NAME = 'ix_mov_sede_estado'");
        if ($existeViejo) Db::pdo()->exec('ALTER TABLE movimientos DROP INDEX ix_mov_sede_estado');
        $indices = [
            'ix_mov_estado_sede'    => '(estado, sede_id)',
            'ix_mov_espacio_estado' => '(espacio_id, estado)',
            'ix_mov_entrada'        => '(entrada_at)',
        ];
        foreach ($indices as $nombre => $cols) {
            $existe = (int) Db::value(
                'SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
                ['movimientos', $nombre]
            );
            if (!$existe) Db::pdo()->exec("ALTER TABLE movimientos ADD INDEX $nombre $cols");
        }
    }
}
