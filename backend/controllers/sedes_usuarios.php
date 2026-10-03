<?php
/**
 * /sedes y /usuarios
 */
return function (Router $r) {

    // ---------------------------------------------------------------- SEDES
    $r->get('/sedes', function () {
        Auth::user();
        $todas = Auth::isSuper() && Http::query('todas') === '1';
        $where = $todas ? '1=1' : 's.activa = 1 AND s.id IN (' . Db::in(Auth::sedeIds()) . ')';
        $params = $todas ? [] : (Auth::sedeIds() ?: [0]);
        $rows = Db::all(
            "SELECT s.*,
                (SELECT COUNT(*) FROM espacios e WHERE e.sede_id = s.id AND e.estado <> 'inactivo') AS capacidad,
                (SELECT COUNT(*) FROM espacios e WHERE e.sede_id = s.id AND e.estado = 'ocupado')   AS ocupados
             FROM sedes s WHERE $where ORDER BY s.nombre",
            $params
        );
        Http::json(['ok' => true, 'sedes' => $rows]);
    });

    $r->post('/sedes', function () {
        Auth::role('superadmin');
        $b = Http::body();
        Http::require($b, ['nombre']);

        $id = Db::tx(function () use ($b) {
            $id = Db::insert(
                'INSERT INTO sedes (nombre, direccion, telefono) VALUES (?,?,?)',
                [trim($b['nombre']), $b['direccion'] ?? null, $b['telefono'] ?? null]
            );
            // Tarifas iniciales: se copian de la primera sede existente o quedan en cero.
            $base = Db::value('SELECT MIN(id) FROM sedes WHERE id <> ?', [$id]);
            foreach (Parking::TIPOS as $tipo) {
                $t = $base ? Parking::tarifa((int) $base, $tipo) : null;
                Db::exec(
                    'INSERT INTO tarifas (sede_id, tipo_vehiculo, modo_cobro, valor_fraccion, valor_hora, fraccion_minutos, minutos_gracia, tope_dia, valor_mensualidad)
                     VALUES (?,?,?,?,?,?,?,?,?)',
                    [$id, $tipo, $t['modo_cobro'] ?? 'fraccion', $t['valor_fraccion'] ?? 0, $t['valor_hora'] ?? 0,
                     $t['fraccion_minutos'] ?? 15, $t['minutos_gracia'] ?? 5, $t['tope_dia'] ?? 0, $t['valor_mensualidad'] ?? 0]
                );
            }
            // Generación rápida de espacios: C-01..C-NN (carros), M-01.. (motos), B-01.. (bicicletas)
            foreach (['carro' => 'C', 'moto' => 'M', 'bicicleta' => 'B'] as $tipo => $pref) {
                $n = min(500, max(0, (int) ($b["espacios_$tipo"] ?? 0)));
                for ($i = 1; $i <= $n; $i++) {
                    Db::exec('INSERT INTO espacios (sede_id, codigo, tipo_vehiculo) VALUES (?,?,?)', [$id, sprintf('%s-%02d', $pref, $i), $tipo]);
                }
            }
            return $id;
        });

        Audit::log('crear', 'sede', $id, $b, $id);
        Http::json(['ok' => true, 'id' => $id], 201);
    });

    $r->put('/sedes/{id}', function ($p) {
        Auth::role('superadmin');
        $b = Http::body();
        Http::require($b, ['nombre']);
        Db::exec('UPDATE sedes SET nombre = ?, direccion = ?, telefono = ? WHERE id = ?', [trim($b['nombre']), $b['direccion'] ?? null, $b['telefono'] ?? null, (int) $p['id']]);
        Audit::log('editar', 'sede', (int) $p['id'], $b, (int) $p['id']);
        Http::json(['ok' => true]);
    });

    $r->patch('/sedes/{id}/estado', function ($p) {
        Auth::role('superadmin');
        $activa = !empty(Http::body()['activa']) ? 1 : 0;
        if (!$activa) {
            $activos = (int) Db::value("SELECT COUNT(*) FROM movimientos WHERE sede_id = ? AND estado = 'activo'", [(int) $p['id']]);
            if ($activos) Http::fail(409, "La sede tiene $activos vehículo(s) dentro. Registre su salida antes de desactivarla.");
        }
        Db::exec('UPDATE sedes SET activa = ? WHERE id = ?', [$activa, (int) $p['id']]);
        Audit::log($activa ? 'activar' : 'desactivar', 'sede', (int) $p['id'], null, (int) $p['id']);
        Http::json(['ok' => true]);
    });

    // ------------------------------------------------------------- USUARIOS
    $visibles = function (): array {
        $u = Auth::user();
        if ($u['rol'] === 'superadmin') {
            return Db::all('SELECT id, nombre, email, rol, activo, ultimo_acceso, created_at, foto FROM usuarios ORDER BY rol, nombre');
        }
        // Un admin ve a los usuarios que comparten alguna de sus sedes
        return Db::all(
            'SELECT DISTINCT u.id, u.nombre, u.email, u.rol, u.activo, u.ultimo_acceso, u.created_at, u.foto
             FROM usuarios u JOIN usuario_sede us ON us.usuario_id = u.id
             WHERE us.sede_id IN (' . Db::in(Auth::sedeIds()) . ") AND u.rol <> 'superadmin'
             ORDER BY u.rol, u.nombre",
            Auth::sedeIds() ?: [0]
        );
    };

    /** Valida rol y sedes según quién está editando. */
    $validar = function (array $b, ?int $editId = null): array {
        $yo = Auth::role('superadmin', 'admin');
        $rol = $b['rol'] ?? 'operador';
        if (!in_array($rol, Auth::ROLES, true)) Http::fail(422, 'Rol inválido');
        if ($yo['rol'] === 'admin' && $rol !== 'operador') Http::fail(403, 'Un administrador solo puede gestionar operadores');

        $sedes = array_values(array_unique(array_map('intval', (array) ($b['sedes'] ?? []))));
        if ($rol !== 'superadmin' && !$sedes) Http::fail(422, 'Asigne al menos una sede');
        if ($rol === 'operador' && count($sedes) > 1) Http::fail(422, 'Un operador trabaja en una sola sede');
        foreach ($sedes as $s) Auth::checkSede($s);

        if ($editId !== null && $yo['rol'] === 'admin') {
            $objetivo = Db::value('SELECT rol FROM usuarios WHERE id = ?', [$editId]);
            if ($objetivo !== 'operador') Http::fail(403, 'Un administrador solo puede gestionar operadores');
        }
        return [$rol, $rol === 'superadmin' ? [] : $sedes];
    };

    $r->get('/usuarios', function () use ($visibles) {
        Auth::role('superadmin', 'admin');
        $usuarios = $visibles();
        $asig = [];
        foreach (Db::all('SELECT us.usuario_id, s.id, s.nombre FROM usuario_sede us JOIN sedes s ON s.id = us.sede_id') as $row) {
            $asig[$row['usuario_id']][] = ['id' => (int) $row['id'], 'nombre' => $row['nombre']];
        }
        foreach ($usuarios as &$u) $u['sedes'] = $asig[$u['id']] ?? [];
        Http::json(['ok' => true, 'usuarios' => $usuarios]);
    });

    $r->post('/usuarios', function () use ($validar) {
        $b = Http::body();
        Http::require($b, ['nombre', 'email', 'password']);
        [$rol, $sedes] = $validar($b);
        if (strlen((string) $b['password']) < 8) Http::fail(422, 'La contraseña debe tener al menos 8 caracteres');
        if (!filter_var($b['email'], FILTER_VALIDATE_EMAIL)) Http::fail(422, 'Correo inválido');
        if (Db::value('SELECT id FROM usuarios WHERE email = ?', [strtolower(trim($b['email']))])) Http::fail(409, 'Ese correo ya está en uso por otro usuario');

        $id = Db::tx(function () use ($b, $rol, $sedes) {
            $id = Db::insert(
                'INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?,?,?,?)',
                [trim($b['nombre']), strtolower(trim($b['email'])), password_hash($b['password'], PASSWORD_DEFAULT), $rol]
            );
            foreach ($sedes as $s) Db::exec('INSERT INTO usuario_sede (usuario_id, sede_id) VALUES (?,?)', [$id, $s]);
            return $id;
        });
        Audit::log('crear', 'usuario', $id, ['email' => $b['email'], 'rol' => $rol, 'sedes' => $sedes]);
        Http::json(['ok' => true, 'id' => $id], 201);
    });

    $r->put('/usuarios/{id}', function ($p) use ($validar) {
        $id = (int) $p['id'];
        $b = Http::body();
        Http::require($b, ['nombre', 'email']);
        [$rol, $sedes] = $validar($b, $id);
        if ($id === Auth::user()['id'] && $rol !== Auth::user()['rol']) Http::fail(422, 'No puede cambiar su propio rol');
        if (!filter_var($b['email'], FILTER_VALIDATE_EMAIL)) Http::fail(422, 'Correo inválido');
        if (Db::value('SELECT id FROM usuarios WHERE email = ? AND id <> ?', [strtolower(trim($b['email'])), $id])) Http::fail(409, 'Ese correo ya está en uso por otro usuario');

        Db::tx(function () use ($id, $b, $rol, $sedes) {
            Db::exec('UPDATE usuarios SET nombre = ?, email = ?, rol = ? WHERE id = ?', [trim($b['nombre']), strtolower(trim($b['email'])), $rol, $id]);
            if (!empty($b['password'])) {
                if (strlen($b['password']) < 8) Http::fail(422, 'La contraseña debe tener al menos 8 caracteres');
                Db::exec('UPDATE usuarios SET password_hash = ? WHERE id = ?', [password_hash($b['password'], PASSWORD_DEFAULT), $id]);
            }
            Db::exec('DELETE FROM usuario_sede WHERE usuario_id = ?', [$id]);
            foreach ($sedes as $s) Db::exec('INSERT INTO usuario_sede (usuario_id, sede_id) VALUES (?,?)', [$id, $s]);
        });
        Audit::log('editar', 'usuario', $id, ['rol' => $rol, 'sedes' => $sedes, 'cambio_password' => !empty($b['password'])]);
        Http::json(['ok' => true]);
    });

    $r->patch('/usuarios/{id}/estado', function ($p) use ($validar) {
        $id = (int) $p['id'];
        if ($id === Auth::user()['id']) Http::fail(422, 'No puede desactivarse a sí mismo');
        $actual = Db::one('SELECT rol FROM usuarios WHERE id = ?', [$id]) ?? Http::fail(404, 'Usuario no encontrado');
        $sedes = array_map(fn($r) => (int) $r['sede_id'], Db::all('SELECT sede_id FROM usuario_sede WHERE usuario_id = ?', [$id]));
        $validar(['rol' => $actual['rol'], 'sedes' => $sedes], $id);
        $activo = !empty(Http::body()['activo']) ? 1 : 0;
        Db::exec('UPDATE usuarios SET activo = ? WHERE id = ?', [$activo, $id]);
        Audit::log($activo ? 'activar' : 'desactivar', 'usuario', $id);
        Http::json(['ok' => true]);
    });

    // Eliminar un usuario. Sus entradas, salidas y cobros pasados se conservan (quedan como "Usuario eliminado")
    // porque las llaves foráneas los ponen en NULL; la auditoría guarda quién era.
    $r->delete('/usuarios/{id}', function ($p) use ($validar) {
        $id = (int) $p['id'];
        if ($id === Auth::user()['id']) Http::fail(422, 'No puede eliminar su propia cuenta');
        $u = Db::one('SELECT id, nombre, email, rol, activo FROM usuarios WHERE id = ?', [$id]) ?? Http::fail(404, 'Usuario no encontrado');
        $sedes = array_map(fn($r) => (int) $r['sede_id'], Db::all('SELECT sede_id FROM usuario_sede WHERE usuario_id = ?', [$id]));
        $validar(['rol' => $u['rol'], 'sedes' => $sedes], $id);   // un administrador solo elimina operadores de sus sedes
        if ($u['rol'] === 'superadmin' && (int) Db::value("SELECT COUNT(*) FROM usuarios WHERE rol = 'superadmin' AND activo = 1 AND id <> ?", [$id]) === 0) {
            Http::fail(422, 'Es el único superadministrador activo: cree otro antes de eliminarlo');
        }
        Db::exec('DELETE FROM usuarios WHERE id = ?', [$id]);
        Audit::log('eliminar', 'usuario', $id, ['nombre' => $u['nombre'], 'email' => $u['email'], 'rol' => $u['rol']], $sedes[0] ?? null);
        Http::json(['ok' => true]);
    });
};
