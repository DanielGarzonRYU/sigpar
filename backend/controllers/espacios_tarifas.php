<?php
/**
 * /espacios y /tarifas
 */
return function (Router $r) {

    $espacio = function (int $id): array {
        $e = Db::one('SELECT * FROM espacios WHERE id = ?', [$id]) ?? Http::fail(404, 'Espacio no encontrado');
        Auth::checkSede($e['sede_id']);
        return $e;
    };

    // Mapa de espacios con el vehículo que ocupa cada uno (tiempo real).
    $r->get('/espacios', function () {
        $sedes = Auth::sedeFilter(Http::query('sede_id'));
        $rows = Parking::mapaEspacios($sedes);
        Http::json(['ok' => true, 'espacios' => $rows, 'servidor_hora' => date('Y-m-d H:i:s')]);
    });

    $r->post('/espacios', function () {
        Auth::role('superadmin', 'admin');
        $b = Http::body();
        Http::require($b, ['sede_id', 'codigo', 'tipo_vehiculo']);
        $sede = Auth::checkSede($b['sede_id']);
        $id = Db::insert(
            'INSERT INTO espacios (sede_id, codigo, tipo_vehiculo, nota) VALUES (?,?,?,?)',
            [$sede, strtoupper(trim($b['codigo'])), Parking::tipo($b['tipo_vehiculo']), $b['nota'] ?? null]
        );
        Audit::log('crear', 'espacio', $id, $b, $sede);
        Http::json(['ok' => true, 'id' => $id], 201);
    });

    // Crear varios espacios de una vez: prefijo "C", cantidad 20 → C-01..C-20 (continúa la numeración).
    $r->post('/espacios/lote', function () {
        Auth::role('superadmin', 'admin');
        $b = Http::body();
        Http::require($b, ['sede_id', 'tipo_vehiculo', 'cantidad', 'prefijo']);
        $sede = Auth::checkSede($b['sede_id']);
        $tipo = Parking::tipo($b['tipo_vehiculo']);
        $cant = min(200, max(1, (int) $b['cantidad']));
        $pref = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $b['prefijo'])) ?: 'E';

        $creados = Db::tx(function () use ($sede, $tipo, $cant, $pref) {
            $existentes = array_column(Db::all('SELECT codigo FROM espacios WHERE sede_id = ?', [$sede]), 'codigo');
            $n = 0; $i = 1;
            while ($n < $cant) {
                $codigo = sprintf('%s-%02d', $pref, $i++);
                if (in_array($codigo, $existentes, true)) continue;
                Db::exec('INSERT INTO espacios (sede_id, codigo, tipo_vehiculo) VALUES (?,?,?)', [$sede, $codigo, $tipo]);
                $n++;
            }
            return $n;
        });
        Audit::log('crear_lote', 'espacio', null, ['tipo' => $tipo, 'cantidad' => $creados, 'prefijo' => $pref], $sede);
        Http::json(['ok' => true, 'creados' => $creados], 201);
    });

    /**
     * Ajustar la capacidad: "en esta sede caben N vehículos de este tipo".
     * - Si aumenta: reactiva espacios inactivos y, si faltan, crea nuevos (C-25, C-26…).
     * - Si disminuye: retira espacios LIBRES (nunca ocupados ni reservados), empezando por los últimos.
     *   Los que tienen historial se inhabilitan (para no perder trazabilidad); los demás se eliminan.
     */
    $r->put('/espacios/capacidad', function () {
        Auth::role('superadmin', 'admin');
        $b = Http::body();
        Http::require($b, ['sede_id', 'tipo_vehiculo']);
        $sede = Auth::checkSede($b['sede_id']);
        $tipo = Parking::tipo($b['tipo_vehiculo']);
        $meta = (int) ($b['cantidad'] ?? -1);
        if ($meta < 0 || $meta > 2000) Http::fail(422, 'La capacidad debe estar entre 0 y 2000');
        $pref = ['carro' => 'C', 'moto' => 'M', 'bicicleta' => 'B'][$tipo];

        $res = Db::tx(function () use ($sede, $tipo, $meta, $pref) {
            $todos = Db::all(
                'SELECT id, codigo, estado FROM espacios WHERE sede_id = ? AND tipo_vehiculo = ? ORDER BY LENGTH(codigo), codigo FOR UPDATE',
                [$sede, $tipo]
            );
            $activos = array_values(array_filter($todos, fn($e) => $e['estado'] !== 'inactivo'));
            $actual = count($activos);
            $creados = $reactivados = $retirados = 0;

            if ($meta > $actual) {
                $faltan = $meta - $actual;
                foreach ($todos as $e) {
                    if (!$faltan) break;
                    if ($e['estado'] !== 'inactivo') continue;
                    Db::exec("UPDATE espacios SET estado = 'disponible' WHERE id = ?", [$e['id']]);
                    $reactivados++; $faltan--;
                }
                $codigos = array_column(Db::all('SELECT codigo FROM espacios WHERE sede_id = ?', [$sede]), 'codigo');
                for ($i = 1; $faltan > 0; $i++) {
                    $codigo = sprintf('%s-%02d', $pref, $i);
                    if (in_array($codigo, $codigos, true)) continue;
                    Db::exec('INSERT INTO espacios (sede_id, codigo, tipo_vehiculo) VALUES (?,?,?)', [$sede, $codigo, $tipo]);
                    $creados++; $faltan--;
                }
            } elseif ($meta < $actual) {
                $sobran = $actual - $meta;
                $libres = array_reverse(array_values(array_filter($activos, fn($e) => $e['estado'] === 'disponible')));
                if (count($libres) < $sobran) {
                    $bloq = $actual - count($libres);
                    Http::fail(409, "Solo se pueden retirar " . count($libres) . " espacio(s) libre(s): hay $bloq ocupado(s) o reservado(s). "
                        . "La capacidad mínima posible ahora es $bloq.");
                }
                foreach (array_slice($libres, 0, $sobran) as $e) {
                    $usado = (int) Db::value('SELECT COUNT(*) FROM movimientos WHERE espacio_id = ?', [$e['id']]);
                    if ($usado) Db::exec("UPDATE espacios SET estado = 'inactivo' WHERE id = ?", [$e['id']]);
                    else Db::exec('DELETE FROM espacios WHERE id = ?', [$e['id']]);
                    $retirados++;
                }
            }
            return ['anterior' => $actual, 'capacidad' => $meta, 'creados' => $creados, 'reactivados' => $reactivados, 'retirados' => $retirados];
        });

        Audit::log('ajustar_capacidad', 'espacio', null, ['tipo' => $tipo] + $res, $sede);
        Http::json(['ok' => true] + $res);
    });

    $r->put('/espacios/{id}', function ($p) use ($espacio) {
        Auth::role('superadmin', 'admin');
        $e = $espacio((int) $p['id']);
        $b = Http::body();
        Http::require($b, ['codigo', 'tipo_vehiculo']);
        if ($e['estado'] === 'ocupado' && $b['tipo_vehiculo'] !== $e['tipo_vehiculo']) {
            Http::fail(409, 'No se puede cambiar el tipo de un espacio ocupado. Registre primero la salida del vehículo.');
        }
        Db::exec(
            'UPDATE espacios SET codigo = ?, tipo_vehiculo = ?, nota = ? WHERE id = ?',
            [strtoupper(trim($b['codigo'])), Parking::tipo($b['tipo_vehiculo']), $b['nota'] ?? null, $e['id']]
        );
        Audit::log('editar', 'espacio', (int) $e['id'], $b, (int) $e['sede_id']);
        Http::json(['ok' => true]);
    });

    // Reservar / liberar (operador) o inhabilitar (admin).
    $r->patch('/espacios/{id}/estado', function ($p) use ($espacio) {
        $u = Auth::user();
        $e = $espacio((int) $p['id']);
        $b = Http::body();
        $nuevo = $b['estado'] ?? '';
        if (!in_array($nuevo, ['disponible', 'reservado', 'inactivo'], true)) Http::fail(422, 'Estado inválido');
        if ($e['estado'] === 'ocupado') Http::fail(409, 'El espacio está ocupado. Registre primero la salida del vehículo.');
        if (($nuevo === 'inactivo' || $e['estado'] === 'inactivo') && $u['rol'] === 'operador') {
            Http::fail(403, 'Solo un administrador puede habilitar o inhabilitar espacios');
        }
        Db::exec('UPDATE espacios SET estado = ?, nota = ? WHERE id = ?', [$nuevo, $b['nota'] ?? $e['nota'], $e['id']]);
        Audit::log('estado_' . $nuevo, 'espacio', (int) $e['id'], ['codigo' => $e['codigo'], 'nota' => $b['nota'] ?? null], (int) $e['sede_id']);
        Http::json(['ok' => true]);
    });

    $r->delete('/espacios/{id}', function ($p) use ($espacio) {
        Auth::role('superadmin', 'admin');
        $e = $espacio((int) $p['id']);
        if ($e['estado'] === 'ocupado') Http::fail(409, 'No se puede eliminar un espacio ocupado');
        $usado = (int) Db::value('SELECT COUNT(*) FROM movimientos WHERE espacio_id = ?', [$e['id']]);
        if ($usado) {
            // Tiene historial: se inhabilita para no perder la trazabilidad.
            Db::exec("UPDATE espacios SET estado = 'inactivo' WHERE id = ?", [$e['id']]);
            Audit::log('estado_inactivo', 'espacio', (int) $e['id'], 'Tiene historial; se inhabilitó en lugar de eliminar', (int) $e['sede_id']);
            Http::json(['ok' => true, 'inhabilitado' => true]);
            return;
        }
        Db::exec('DELETE FROM espacios WHERE id = ?', [$e['id']]);
        Audit::log('eliminar', 'espacio', (int) $e['id'], ['codigo' => $e['codigo']], (int) $e['sede_id']);
        Http::json(['ok' => true]);
    });

    // --------------------------------------------------------------- TARIFAS
    $r->get('/tarifas', function () {
        $sedes = Auth::sedeFilter(Http::query('sede_id'));
        $rows = Db::all(
            "SELECT t.*, s.nombre AS sede FROM tarifas t JOIN sedes s ON s.id = t.sede_id
             WHERE t.sede_id IN (" . Db::in($sedes) . ") ORDER BY s.nombre, FIELD(t.tipo_vehiculo,'carro','moto','bicicleta')",
            $sedes
        );
        Http::json(['ok' => true, 'tarifas' => $rows]);
    });

    $r->put('/tarifas/{sede_id}', function ($p) {
        Auth::role('superadmin', 'admin');
        $sede = Auth::checkSede($p['sede_id']);
        $lista = Http::body()['tarifas'] ?? [];
        if (!is_array($lista) || !$lista) Http::fail(422, 'Envíe la lista de tarifas');

        Db::tx(function () use ($sede, $lista) {
            foreach ($lista as $t) {
                $tipo = Parking::tipo($t['tipo_vehiculo'] ?? null);
                $modo = $t['modo_cobro'] ?? 'fraccion';
                if (!in_array($modo, Parking::MODOS, true)) Http::fail(422, 'Modo de cobro inválido');
                $num = fn($k, $def = 0) => max(0, (float) ($t[$k] ?? $def));
                $fraccion = (int) $num('fraccion_minutos', 15);
                if ($modo === 'fraccion' && ($fraccion < 1 || $fraccion > 1440)) Http::fail(422, 'La fracción debe estar entre 1 y 1440 minutos');
                $fila = ['modo_cobro' => $modo, 'valor_fraccion' => $num('valor_fraccion'), 'fraccion_minutos' => max(1, $fraccion)];
                Db::exec(
                    'INSERT INTO tarifas (sede_id, tipo_vehiculo, modo_cobro, valor_fraccion, valor_hora, fraccion_minutos, minutos_gracia, tope_dia, valor_mensualidad, updated_at)
                     VALUES (?,?,?,?,?,?,?,?,?, NOW())
                     ON DUPLICATE KEY UPDATE modo_cobro = VALUES(modo_cobro), valor_fraccion = VALUES(valor_fraccion),
                       valor_hora = VALUES(valor_hora), fraccion_minutos = VALUES(fraccion_minutos),
                       minutos_gracia = VALUES(minutos_gracia), tope_dia = VALUES(tope_dia),
                       valor_mensualidad = VALUES(valor_mensualidad), updated_at = NOW()',
                    [$sede, $tipo, $modo, $fila['valor_fraccion'], Parking::valorHoraEquivalente($fila), $fila['fraccion_minutos'],
                     (int) $num('minutos_gracia', 5), $num('tope_dia'), $num('valor_mensualidad')]
                );
            }
        });
        Audit::log('actualizar', 'tarifas', null, $lista, $sede);
        Http::json(['ok' => true]);
    });
};
