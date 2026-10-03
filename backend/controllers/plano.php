<?php
/**
 * /sedes/{id}/plano: el plano dibujado de cada sede.
 *
 * No todos los parqueaderos son filas ordenadas: el administrador dibuja su lote en una cuadrícula
 * (vías, entrada, salida, columnas, zonas) y ubica cada espacio donde realmente está. La operación
 * (web y app) muestra ese plano con el estado en vivo de cada espacio.
 *
 * Unidad: 1 celda ≈ 1,25 m. Huella de cada espacio (ancho x largo, en celdas) según PLANO_HUELLA.
 */
return function (Router $r) {

    $TIPOS_ELEMENTO = ['via', 'zona', 'muro', 'columna', 'entrada', 'salida', 'caseta', 'texto'];
    $MAX_LADO = 160;

    $espaciosPlano = fn(int $sede) => Db::all(
        "SELECT id, codigo, tipo_vehiculo, estado, plano_x, plano_y, plano_rot FROM espacios
         WHERE sede_id = ? ORDER BY tipo_vehiculo, LENGTH(codigo), codigo",
        [$sede]
    );

    $r->get('/sedes/{id}/plano', function ($p) use ($espaciosPlano) {
        $sede = Auth::checkSede($p['id']);
        // La foto de calco solo la pide el editor (?fondo=1): la operación en vivo no la necesita
        $conFondo = (bool) Http::query('fondo');
        $s = Db::one('SELECT plano, plano_at' . ($conFondo ? ', plano_fondo' : '') . ' FROM sedes WHERE id = ?', [$sede]) ?? Http::fail(404, 'Sede no encontrada');
        $r = [
            'ok' => true,
            'plano' => $s['plano'] ? json_decode($s['plano'], true) : null,
            'plano_at' => $s['plano_at'],
            'espacios' => $espaciosPlano($sede),
        ];
        if ($conFondo) {
            $r['fondo'] = $s['plano_fondo'] ? json_decode($s['plano_fondo'], true) : null;
            $r['ia'] = Ia::configurada();
        }
        Http::json($r);
    });

    $r->put('/sedes/{id}/plano', function ($p) use ($TIPOS_ELEMENTO, $MAX_LADO, $espaciosPlano) {
        Auth::role('superadmin', 'admin');
        $sede = Auth::checkSede($p['id']);
        $b = Http::body();
        $ancho = (int) ($b['ancho'] ?? 0);
        $alto  = (int) ($b['alto'] ?? 0);
        if ($ancho < 8 || $alto < 8 || $ancho > $MAX_LADO || $alto > $MAX_LADO) {
            Http::fail(422, "El lote debe medir entre 8 y $MAX_LADO celdas por lado");
        }
        $dentro = fn(int $x, int $y, int $w, int $h) => $x >= 0 && $y >= 0 && $w >= 1 && $h >= 1 && $x + $w <= $ancho && $y + $h <= $alto;

        // Elementos del dibujo (se guardan tal cual, ya validados y recortados)
        $elementos = [];
        foreach (array_slice((array) ($b['elementos'] ?? []), 0, 600) as $el) {
            $t = $el['t'] ?? '';
            if (!in_array($t, $TIPOS_ELEMENTO, true)) Http::fail(422, 'Elemento de plano no válido');
            $x = (int) ($el['x'] ?? -1); $y = (int) ($el['y'] ?? -1); $w = (int) ($el['w'] ?? 1); $h = (int) ($el['h'] ?? 1);
            if (!$dentro($x, $y, $w, $h)) Http::fail(422, 'Hay elementos por fuera del lote. Agrande el lote o muévalos.');
            $fila = ['t' => $t, 'x' => $x, 'y' => $y, 'w' => $w, 'h' => $h];
            if ($t === 'texto') $fila['texto'] = mb_substr(trim((string) ($el['texto'] ?? '')), 0, 40);
            $elementos[] = $fila;
        }

        // Ubicación de los espacios existentes (solo los de esta sede)
        $actuales = [];
        foreach ($espaciosPlano($sede) as $e) $actuales[(int) $e['id']] = $e;
        $ubicar = [];
        foreach ((array) ($b['espacios'] ?? []) as $e) {
            $id = (int) ($e['id'] ?? 0);
            if (!isset($actuales[$id])) continue;
            $ubicar[$id] = ($e['x'] ?? null) === null ? null : ['x' => (int) $e['x'], 'y' => (int) $e['y'], 'rot' => (int) !empty($e['rot'])];
        }
        $nuevos = array_slice((array) ($b['nuevos'] ?? []), 0, 300);

        // Foto de calco: sin la clave 'fondo' no se toca; null la quita
        $fondo = false;
        if (array_key_exists('fondo', $b)) {
            $fondo = null;
            if (is_array($b['fondo'])) {
                $img = (string) ($b['fondo']['img'] ?? '');
                if (!preg_match('#^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$#', $img)) Http::fail(422, 'La foto de calco debe ser JPG, PNG o WEBP');
                if (strlen($img) > 4_000_000) Http::fail(422, 'La foto de calco es muy pesada (máximo 3 MB)');
                $num = fn($k, $min, $max, $def) => max($min, min($max, round((float) ($b['fondo'][$k] ?? $def), 3)));
                $fondo = json_encode(['img' => $img, 'x' => $num('x', -$MAX_LADO, $MAX_LADO, 0), 'y' => $num('y', -$MAX_LADO, $MAX_LADO, 0),
                    'w' => $num('w', 1, $MAX_LADO * 3, $ancho), 'h' => $num('h', 1, $MAX_LADO * 3, $alto), 'op' => $num('op', 0.05, 1, 0.5)]);
            }
        }

        // Validar que ningún espacio quede fuera del lote ni encima de otro
        $ocupadas = [];
        $marcar = function (string $nombre, string $tipo, array $pos) use (&$ocupadas, $dentro) {
            [$w, $h] = Parking::huella($tipo, $pos['rot']);
            if (!$dentro($pos['x'], $pos['y'], $w, $h)) Http::fail(422, "El espacio $nombre quedó por fuera del lote");
            for ($i = $pos['x']; $i < $pos['x'] + $w; $i++) {
                for ($j = $pos['y']; $j < $pos['y'] + $h; $j++) {
                    $k = "$i,$j";
                    if (isset($ocupadas[$k])) Http::fail(422, "Los espacios $nombre y {$ocupadas[$k]} están uno encima del otro");
                    $ocupadas[$k] = $nombre;
                }
            }
        };
        foreach ($actuales as $id => $e) {
            $pos = array_key_exists($id, $ubicar) ? $ubicar[$id]
                : ($e['plano_x'] === null ? null : ['x' => (int) $e['plano_x'], 'y' => (int) $e['plano_y'], 'rot' => (int) $e['plano_rot']]);
            if ($pos) $marcar($e['codigo'], $e['tipo_vehiculo'], $pos);
        }
        foreach ($nuevos as $i => $n) {
            $marcar('nuevo ' . ($i + 1), Parking::tipo($n['tipo'] ?? null), ['x' => (int) ($n['x'] ?? -1), 'y' => (int) ($n['y'] ?? -1), 'rot' => (int) !empty($n['rot'])]);
        }

        $creados = Db::tx(function () use ($sede, $ancho, $alto, $elementos, $ubicar, $nuevos, $fondo) {
            Db::exec('UPDATE sedes SET plano = ?, plano_at = NOW() WHERE id = ?',
                [json_encode(['ancho' => $ancho, 'alto' => $alto, 'elementos' => $elementos], JSON_UNESCAPED_UNICODE), $sede]);
            if ($fondo !== false) Db::exec('UPDATE sedes SET plano_fondo = ? WHERE id = ?', [$fondo, $sede]);
            foreach ($ubicar as $id => $pos) {
                Db::exec('UPDATE espacios SET plano_x = ?, plano_y = ?, plano_rot = ? WHERE id = ? AND sede_id = ?',
                    [$pos['x'] ?? null, $pos['y'] ?? null, $pos['rot'] ?? 0, $id, $sede]);
            }
            // Espacios nuevos dibujados en el plano: código automático que continúa la numeración (C-25, M-09…)
            $codigos = array_column(Db::all('SELECT codigo FROM espacios WHERE sede_id = ? FOR UPDATE', [$sede]), 'codigo');
            $creados = [];
            foreach ($nuevos as $n) {
                $tipo = Parking::tipo($n['tipo'] ?? null);
                $pref = ['carro' => 'C', 'moto' => 'M', 'bicicleta' => 'B'][$tipo];
                for ($i = 1; in_array($codigo = sprintf('%s-%02d', $pref, $i), $codigos, true); $i++);
                $codigos[] = $codigo;
                Db::exec('INSERT INTO espacios (sede_id, codigo, tipo_vehiculo, plano_x, plano_y, plano_rot) VALUES (?,?,?,?,?,?)',
                    [$sede, $codigo, $tipo, (int) $n['x'], (int) $n['y'], (int) !empty($n['rot'])]);
                $creados[] = $codigo;
            }
            return $creados;
        });

        $ubicados = count(array_filter($ubicar));
        Audit::log('guardar_plano', 'sede', $sede, ['ancho' => $ancho, 'alto' => $alto, 'elementos' => count($elementos),
            'espacios_ubicados' => $ubicados, 'espacios_nuevos' => $creados], $sede);
        Http::json(['ok' => true, 'creados' => $creados, 'espacios' => $espaciosPlano($sede)]);
    });

    // Propuesta de plano a partir de una foto, un boceto o una descripción (IA opcional, ver Ia.php).
    // No guarda nada: el editor la muestra para que el administrador la revise antes de guardar.
    $r->post('/sedes/{id}/plano/interpretar', function ($p) {
        Auth::role('superadmin', 'admin');
        $sede = Auth::checkSede($p['id']);
        if (!Ia::configurada()) Http::fail(501, 'La lectura con IA no está activada en este servidor (falta ANTHROPIC_API_KEY)');
        $b = Http::body();
        $imagen = isset($b['imagen']) && $b['imagen'] !== '' ? (string) $b['imagen'] : null;
        $texto = mb_substr(trim((string) ($b['texto'] ?? '')), 0, 1500);
        if ($imagen === null && $texto === '') Http::fail(422, 'Adjunte una imagen o describa su parqueadero');
        $conteos = [];
        foreach (Db::all("SELECT tipo_vehiculo, COUNT(*) n FROM espacios WHERE sede_id = ? AND estado <> 'inactivo' GROUP BY tipo_vehiculo", [$sede]) as $f) {
            $conteos[$f['tipo_vehiculo']] = (int) $f['n'];
        }
        $propuesta = Ia::proponerPlano($imagen, $texto, $conteos);
        Audit::log('interpretar_plano', 'sede', $sede, ['imagen' => $imagen !== null, 'espacios' => count($propuesta['espacios'])], $sede);
        Http::json(['ok' => true, 'propuesta' => $propuesta]);
    });

    // Quitar el plano: la operación vuelve a mostrar la cuadrícula ordenada por código.
    $r->delete('/sedes/{id}/plano', function ($p) {
        Auth::role('superadmin', 'admin');
        $sede = Auth::checkSede($p['id']);
        Db::tx(function () use ($sede) {
            Db::exec('UPDATE sedes SET plano = NULL, plano_at = NULL, plano_fondo = NULL WHERE id = ?', [$sede]);
            Db::exec('UPDATE espacios SET plano_x = NULL, plano_y = NULL, plano_rot = 0 WHERE sede_id = ?', [$sede]);
        });
        Audit::log('borrar_plano', 'sede', $sede, null, $sede);
        Http::json(['ok' => true]);
    });
};
