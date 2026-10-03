<?php
/**
 * /health, /auth/*, /config
 */
return function (Router $r) {

    // Usado por UptimeRobot cada 5 min: mantiene despiertos Render y la base de datos.
    $r->get('/health', function () {
        $t = microtime(true);
        Db::value('SELECT 1');
        $ms = round((microtime(true) - $t) * 1000, 1);
        try { Avisos::automaticoDiario(); } catch (Throwable $e) { error_log('[SIGPAR] avisos: ' . $e->getMessage()); }
        Http::json(['ok' => true, 'servicio' => 'SIGPAR API', 'demo' => Env::bool('DEMO_DATA'), 'correo' => Avisos::configurado(),
            'hora' => date('c'), 'db_ms' => $ms]);
    });

    $sesion = function (array $u): array {
        $sedes = Db::all(
            'SELECT id, nombre FROM sedes WHERE activa = 1 AND id IN (' . Db::in(Auth::sedeIds()) . ') ORDER BY nombre',
            Auth::sedeIds() ?: [0]
        );
        return [
            'usuario' => ['id' => $u['id'], 'nombre' => $u['nombre'], 'email' => $u['email'], 'rol' => $u['rol'],
                'foto' => Db::value('SELECT foto FROM usuarios WHERE id = ?', [$u['id']])],
            'sedes'   => $sedes,
            'empresa' => Parking::config('empresa_nombre', 'SIGPAR'),
        ];
    };

    $r->post('/auth/login', function () use ($sesion) {
        $b = Http::body();
        Http::require($b, ['email', 'password']);
        $email = strtolower(trim($b['email']));

        // Protección contra adivinar contraseñas. Se cuenta por correo (8 intentos) y, más holgado,
        // por IP (30): en un parqueadero todos los operadores comparten la misma IP del WiFi.
        $f = Db::one(
            "SELECT COUNT(CASE WHEN detalle = ? THEN 1 END) por_correo, COUNT(CASE WHEN ip = ? THEN 1 END) por_ip
             FROM auditoria WHERE accion = 'login_fallido' AND created_at > NOW() - INTERVAL 15 MINUTE",
            [json_encode(['email' => $email], JSON_UNESCAPED_UNICODE), Http::ip()]
        );
        if ((int) $f['por_correo'] >= 8 || (int) $f['por_ip'] >= 30) Http::fail(429, 'Demasiados intentos fallidos. Espere 15 minutos.');

        $u = Db::one('SELECT * FROM usuarios WHERE email = ?', [$email]);
        if (!$u || !password_verify((string) $b['password'], $u['password_hash'])) {
            Audit::log('login_fallido', 'usuario', $u ? (int) $u['id'] : null, ['email' => $email], null, $u ? (int) $u['id'] : null);
            Http::fail(401, 'Correo o contraseña incorrectos');
        }
        if (!$u['activo']) Http::fail(403, 'Usuario desactivado. Contacte al administrador.');

        Db::exec('UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ?', [$u['id']]);
        $token = Auth::token($u);

        // A partir de aquí el usuario queda "autenticado" para Auth::user()
        $_SERVER['HTTP_AUTHORIZATION'] = "Bearer $token";
        $user = Auth::user();
        Audit::log('login', 'usuario', $user['id'], ['origen' => $b['origen'] ?? 'web']);

        Http::json(['ok' => true, 'token' => $token] + $sesion($user));
    });

    $r->get('/auth/me', function () use ($sesion) {
        Http::json(['ok' => true] + $sesion(Auth::user()));
    });

    // Mi perfil: cada usuario cambia su nombre y su foto (el correo y el rol los cambia un administrador)
    $r->put('/auth/perfil', function () use ($sesion) {
        $u = Auth::user();
        $b = Http::body();
        $nombre = trim((string) ($b['nombre'] ?? ''));
        if (mb_strlen($nombre) < 3) Http::fail(422, 'Escriba su nombre completo');
        if (mb_strlen($nombre) > 100) Http::fail(422, 'El nombre es muy largo');
        Db::exec('UPDATE usuarios SET nombre = ? WHERE id = ?', [$nombre, $u['id']]);
        if (array_key_exists('foto', $b)) {
            $foto = $b['foto'];
            if ($foto !== null) {
                $foto = (string) $foto;
                if (!preg_match('#^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$#', $foto)) Http::fail(422, 'La foto debe ser una imagen JPG o PNG');
                if (strlen($foto) > 400_000) Http::fail(422, 'La foto es muy pesada');
            }
            Db::exec('UPDATE usuarios SET foto = ? WHERE id = ?', [$foto, $u['id']]);
        }
        Audit::log('editar_perfil', 'usuario', $u['id'], ['nombre' => $nombre, 'foto' => array_key_exists('foto', $b) ? ($b['foto'] ? 'cambiada' : 'quitada') : 'sin cambio']);
        $u['nombre'] = $nombre;
        Http::json(['ok' => true] + $sesion($u));
    });

    $r->post('/auth/password', function () {
        $u = Auth::user();
        $b = Http::body();
        Http::require($b, ['actual', 'nueva']);
        $hash = Db::value('SELECT password_hash FROM usuarios WHERE id = ?', [$u['id']]);
        if (!password_verify((string) $b['actual'], $hash)) Http::fail(422, 'La contraseña actual no es correcta');
        if (strlen((string) $b['nueva']) < 8) Http::fail(422, 'La nueva contraseña debe tener al menos 8 caracteres');
        Db::exec('UPDATE usuarios SET password_hash = ? WHERE id = ?', [password_hash($b['nueva'], PASSWORD_DEFAULT), $u['id']]);
        Audit::log('cambiar_password', 'usuario', $u['id']);
        Http::json(['ok' => true]);
    });

    $r->get('/config', function () {
        Auth::user();
        $cfg = [];
        foreach (Db::all('SELECT clave, valor FROM configuracion') as $row) $cfg[$row['clave']] = $row['valor'];
        Http::json(['ok' => true, 'config' => $cfg]);
    });

    $r->put('/config', function () {
        Auth::role('superadmin');
        $permitidas = ['empresa_nombre', 'empresa_nit', 'dias_alerta_abonados', 'redondeo_cobro', 'politica_datos', 'avisos_automaticos'];
        $b = Http::body();
        foreach ($permitidas as $k) {
            if (array_key_exists($k, $b)) {
                Db::exec('REPLACE INTO configuracion (clave, valor) VALUES (?, ?)', [$k, (string) $b[$k]]);
            }
        }
        Audit::log('actualizar', 'configuracion', null, array_intersect_key($b, array_flip($permitidas)));
        Http::json(['ok' => true]);
    });
};
