<?php
/**
 * /movimientos — registro de entradas y salidas (OE1) y cobro automático (OE2).
 * Estos endpoints son los mismos que usará la app Android del operador.
 */
return function (Router $r) {

    $SELECT = "SELECT m.*, s.nombre AS sede, e.codigo AS espacio,
                      ue.nombre AS usuario_entrada, us.nombre AS usuario_salida, a.nombre AS abonado
               FROM movimientos m
               JOIN sedes s ON s.id = m.sede_id
               LEFT JOIN espacios e  ON e.id  = m.espacio_id
               LEFT JOIN usuarios ue ON ue.id = m.usuario_entrada_id
               LEFT JOIN usuarios us ON us.id = m.usuario_salida_id
               LEFT JOIN abonados a  ON a.id  = m.abonado_id";

    $cargar = function (int $id) use ($SELECT): array {
        $m = Db::one("$SELECT WHERE m.id = ?", [$id]) ?? Http::fail(404, 'Movimiento no encontrado');
        Auth::checkSede($m['sede_id']);
        return $m;
    };

    $cotizar = function (array $m, ?string $hasta = null): array {
        $hasta ??= date('Y-m-d H:i:s');
        $esAbonado = $m['abonado_id'] && Parking::abonadoVigente((int) $m['sede_id'], $m['placa'], substr($m['entrada_at'], 0, 10));
        return Parking::calcular($m['entrada_at'], $hasta, Parking::tarifa((int) $m['sede_id'], $m['tipo_vehiculo']), (bool) $esAbonado)
            + ['salida_at' => $hasta, 'es_abonado' => (bool) $esAbonado];
    };

    // Historial con filtros y paginación.
    $r->get('/movimientos', function () use ($SELECT) {
        $sedes = Auth::sedeFilter(Http::query('sede_id'));
        $where = ['m.sede_id IN (' . Db::in($sedes) . ')'];
        $params = $sedes;

        // Placa: búsqueda "empieza por" (ABC → ABC123, ABC45D). Así usa el índice de placas en vez de recorrer todo el historial.
        $placa = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string) Http::query('placa', '')));
        if ($placa !== '') { $where[] = 'm.placa LIKE ?'; $params[] = "$placa%"; }
        if ($estado = Http::query('estado')) { $where[] = 'm.estado = ?'; $params[] = $estado; }
        if ($tipo = Http::query('tipo')) { $where[] = 'm.tipo_vehiculo = ?'; $params[] = $tipo; }
        // Fechas: un movimiento entra en el rango si ENTRÓ o SALIÓ en esas fechas. Así la salida de hoy de un
        // vehículo que entró hace días también aparece (antes solo contaba la fecha de entrada).
        $desde = Http::query('desde'); $hasta = Http::query('hasta');
        foreach ([$desde, $hasta] as $f) if ($f && !DateTime::createFromFormat('Y-m-d', $f)) Http::fail(422, 'Fecha inválida (use AAAA-MM-DD)');
        $d0 = $desde ? "$desde 00:00:00" : '1970-01-01 00:00:00';
        $d1 = $hasta ? "$hasta 23:59:59" : '2999-12-31 23:59:59';

        $w = implode(' AND ', $where);
        $limit = min(5000, max(1, (int) Http::query('limit', 50)));
        $page  = max(1, (int) Http::query('page', 1));
        $hasta_n = $page * $limit;
        if ($hasta_n > 20000) Http::fail(422, 'Use filtros más precisos: hay demasiadas páginas');

        // Dos consultas, cada una por su índice de fecha (entradas y salidas), y se mezclan por el momento
        // más reciente de cada movimiento: lo último que pasó (entrada o salida) queda arriba.
        $idxEnt = $placa !== '' ? '' : 'FORCE INDEX (ix_mov_entrada) ';
        $idxSal = $placa !== '' ? '' : 'FORCE INDEX (ix_mov_sede_salida) ';
        $porEntrada = Db::all("SELECT m.id, m.entrada_at t FROM movimientos m {$idxEnt}WHERE $w AND m.entrada_at BETWEEN ? AND ? ORDER BY m.entrada_at DESC LIMIT $hasta_n",
            array_merge($params, [$d0, $d1]));
        $porSalida = Db::all("SELECT m.id, m.salida_at t FROM movimientos m {$idxSal}WHERE $w AND m.salida_at BETWEEN ? AND ? ORDER BY m.salida_at DESC LIMIT $hasta_n",
            array_merge($params, [$d0, $d1]));
        $momento = [];
        foreach (array_merge($porEntrada, $porSalida) as $f) {
            if (!isset($momento[$f['id']]) || $f['t'] > $momento[$f['id']]) $momento[$f['id']] = $f['t'];
        }
        arsort($momento);
        $ids = array_slice(array_keys($momento), ($page - 1) * $limit, $limit);

        $total = (int) Db::value("SELECT COUNT(*) FROM movimientos m WHERE $w AND m.entrada_at BETWEEN ? AND ?", array_merge($params, [$d0, $d1]))
               + (int) Db::value("SELECT COUNT(*) FROM movimientos m WHERE $w AND m.salida_at BETWEEN ? AND ? AND m.entrada_at NOT BETWEEN ? AND ?",
                   array_merge($params, [$d0, $d1, $d0, $d1]));
        $rows = [];
        if ($ids) {
            $porId = array_column(Db::all("$SELECT WHERE m.id IN (" . Db::in($ids) . ')', $ids), null, 'id');
            foreach ($ids as $i) if (isset($porId[$i])) $rows[] = $porId[$i];
        }

        Http::json(['ok' => true, 'movimientos' => $rows, 'total' => $total, 'page' => $page, 'limit' => $limit]);
    });

    // Vehículos dentro del parqueadero en este momento, con el valor que llevan.
    $activos = function (array $sedes) use ($SELECT, $cotizar): array {
        $rows = Db::all("$SELECT WHERE m.estado = 'activo' AND m.sede_id IN (" . Db::in($sedes) . ') ORDER BY m.entrada_at', $sedes);
        foreach ($rows as &$m) {
            $c = $cotizar($m);
            $m['minutos_actuales'] = $c['minutos'];
            $m['valor_actual'] = $c['valor'];
        }
        return $rows;
    };

    $r->get('/movimientos/activos', function () use ($activos) {
        Http::json(['ok' => true, 'movimientos' => $activos(Auth::sedeFilter(Http::query('sede_id')))]);
    });

    // Estado completo de la operación en UNA sola petición (mapa + vehículos dentro).
    // Es lo que consultan cada 5 s la pantalla de operación y la app: la mitad de peticiones al servidor.
    $r->get('/operacion/estado', function () use ($activos) {
        $sedes = Auth::sedeFilter(Http::query('sede_id'));
        // Solo la versión (fecha) de cada plano: el dibujo completo se pide aparte y únicamente cuando cambia.
        $planos = [];
        foreach (Db::all('SELECT id, plano_at FROM sedes WHERE plano IS NOT NULL AND id IN (' . Db::in($sedes) . ')', $sedes) as $s) {
            $planos[(string) $s['id']] = $s['plano_at'];
        }
        Http::json(['ok' => true, 'espacios' => Parking::mapaEspacios($sedes), 'activos' => $activos($sedes),
            'planos' => (object) $planos, 'servidor_hora' => date('Y-m-d H:i:s')]);
    });

    // ¿Cambió algo en estas sedes? Devuelve una "versión" (el último registro de auditoría de cada sede).
    // La web la consulta cada pocos segundos y, si cambió, refresca la pantalla abierta: así una salida
    // registrada en la app o por otro operador aparece en el historial, la caja y el dashboard sin recargar.
    $r->get('/cambios', function () {
        $sedes = Auth::sedeFilter(Http::query('sede_id'));
        $partes = [];
        foreach ($sedes as $s) {
            // Por cada sede, el último registro usando el índice (sede_id, created_at): no recorre la tabla
            $partes[] = $s . ':' . (Db::value('SELECT id FROM auditoria WHERE sede_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', [$s]) ?? 0);
        }
        Http::json(['ok' => true, 'version' => implode(',', $partes)]);
    });

    // Buscar un vehículo dentro por placa (atajo para la salida desde la app).
    $r->get('/movimientos/buscar-placa', function () use ($SELECT, $cotizar) {
        $placa = Parking::placa(Http::query('placa'));
        $sedes = Auth::sedeFilter(Http::query('sede_id'));
        $m = Db::one("$SELECT WHERE m.estado = 'activo' AND m.placa = ? AND m.sede_id IN (" . Db::in($sedes) . ')', array_merge([$placa], $sedes));
        if (!$m) Http::fail(404, "El vehículo $placa no está registrado dentro del parqueadero");
        Http::json(['ok' => true, 'movimiento' => $m, 'cotizacion' => $cotizar($m)]);
    });

    $r->get('/movimientos/{id}', function ($p) use ($cargar, $cotizar) {
        $m = $cargar((int) $p['id']);
        $extra = $m['estado'] === 'activo' ? ['cotizacion' => $cotizar($m)] : [];
        $sede = Db::one('SELECT nombre, direccion, telefono FROM sedes WHERE id = ?', [$m['sede_id']]);
        Http::json(['ok' => true, 'movimiento' => $m, 'sede' => $sede,
            'empresa' => ['nombre' => Parking::config('empresa_nombre'), 'nit' => Parking::config('empresa_nit')]] + $extra);
    });

    $r->get('/movimientos/{id}/cotizar', function ($p) use ($cargar, $cotizar) {
        $m = $cargar((int) $p['id']);
        if ($m['estado'] !== 'activo') Http::fail(409, 'Este movimiento ya fue cerrado');
        Http::json(['ok' => true, 'cotizacion' => $cotizar($m)]);
    });

    // ---------------------------------------------------------------- ENTRADA
    $r->post('/movimientos/entrada', function () {
        $u = Auth::user();
        $b = Http::body();
        Http::require($b, ['sede_id', 'placa', 'tipo_vehiculo']);
        $sede  = Auth::checkSede($b['sede_id']);
        $placa = Parking::placa($b['placa']);
        $tipo  = Parking::tipo($b['tipo_vehiculo']);
        if (empty($b['autoriza_datos']) && (!empty($b['telefono']) || !empty($b['propietario']))) {
            // Ley 1581: los datos personales solo se guardan con autorización del titular.
            $b['propietario'] = $b['telefono'] = null;
        }

        $res = Db::tx(function () use ($u, $b, $sede, $placa, $tipo) {
            $dentro = Db::one(
                "SELECT m.id, s.nombre AS sede FROM movimientos m JOIN sedes s ON s.id = m.sede_id
                 WHERE m.placa = ? AND m.estado = 'activo' FOR UPDATE",
                [$placa]
            );
            if ($dentro) Http::fail(409, "El vehículo $placa ya está dentro (sede {$dentro['sede']})");

            if (!empty($b['espacio_id'])) {
                $esp = Db::one('SELECT * FROM espacios WHERE id = ? AND sede_id = ? FOR UPDATE', [(int) $b['espacio_id'], $sede]);
                if (!$esp) Http::fail(404, 'Espacio no encontrado en esta sede');
                if (!in_array($esp['estado'], ['disponible', 'reservado'], true)) Http::fail(409, "El espacio {$esp['codigo']} no está disponible");
                if ($esp['tipo_vehiculo'] !== $tipo) Http::fail(422, "El espacio {$esp['codigo']} es para {$esp['tipo_vehiculo']}");
            } else {
                $esp = Db::one(
                    "SELECT * FROM espacios WHERE sede_id = ? AND tipo_vehiculo = ? AND estado = 'disponible'
                     ORDER BY LENGTH(codigo), codigo LIMIT 1 FOR UPDATE",
                    [$sede, $tipo]
                );
                if (!$esp) Http::fail(409, "No hay espacios disponibles para $tipo en esta sede");
            }

            $abonado = Parking::abonadoVigente($sede, $placa);
            $id = Db::insert(
                'INSERT INTO movimientos (sede_id, espacio_id, placa, tipo_vehiculo, propietario, telefono, abonado_id, entrada_at, origen, observacion, usuario_entrada_id)
                 VALUES (?,?,?,?,?,?,?, NOW(), ?, ?, ?)',
                [
                    $sede, $esp['id'], $placa, $tipo,
                    trim((string) ($b['propietario'] ?? '')) ?: ($abonado['nombre'] ?? null),
                    trim((string) ($b['telefono'] ?? '')) ?: ($abonado['telefono'] ?? null),
                    $abonado['id'] ?? null,
                    ($b['origen'] ?? 'web') === 'app' ? 'app' : 'web',
                    $b['observacion'] ?? null,
                    $u['id'],
                ]
            );
            Db::exec("UPDATE espacios SET estado = 'ocupado' WHERE id = ?", [$esp['id']]);
            return ['id' => $id, 'espacio' => $esp['codigo'], 'abonado' => $abonado ? $abonado['nombre'] : null];
        });

        Audit::log('entrada', 'movimiento', $res['id'], ['placa' => $placa, 'espacio' => $res['espacio']], $sede);
        Http::json(['ok' => true, 'formato_colombiano' => Parking::formatoColombiano($placa)] + $res, 201);
    });

    // ----------------------------------------------------------------- SALIDA
    $r->post('/movimientos/{id}/salida', function ($p) use ($cotizar, $cargar) {
        $u = Auth::user();
        $id = (int) $p['id'];
        $b = Http::body();

        $res = Db::tx(function () use ($u, $id, $b, $cotizar) {
            $m = Db::one('SELECT * FROM movimientos WHERE id = ? FOR UPDATE', [$id]) ?? Http::fail(404, 'Movimiento no encontrado');
            Auth::checkSede($m['sede_id']);
            if ($m['estado'] !== 'activo') Http::fail(409, 'Este vehículo ya registró su salida');

            $c = $cotizar($m);
            $metodo = $c['es_abonado'] ? 'abonado' : ($b['metodo_pago'] ?? 'efectivo');
            if (!$c['es_abonado'] && !in_array($metodo, Parking::METODOS_PAGO, true)) Http::fail(422, 'Método de pago inválido');

            Db::exec(
                "UPDATE movimientos SET salida_at = ?, minutos = ?, valor = ?, detalle_cobro = ?, metodo_pago = ?, estado = 'finalizado',
                        usuario_salida_id = ?, observacion = COALESCE(?, observacion) WHERE id = ?",
                [$c['salida_at'], $c['minutos'], $c['valor'], mb_substr($c['detalle'], 0, 255), $metodo, $u['id'], $b['observacion'] ?? null, $id]
            );
            if ($m['espacio_id']) Db::exec("UPDATE espacios SET estado = 'disponible' WHERE id = ?", [$m['espacio_id']]);
            return $c + ['sede_id' => (int) $m['sede_id'], 'placa' => $m['placa'], 'metodo_pago' => $metodo];
        });

        Audit::log('salida', 'movimiento', $id, ['placa' => $res['placa'], 'valor' => $res['valor'], 'metodo' => $res['metodo_pago']], $res['sede_id']);
        Http::json(['ok' => true, 'cobro' => $res, 'movimiento' => $cargar($id)]);
    });

    // Anular un registro erróneo (solo administradores, queda en auditoría).
    $r->post('/movimientos/{id}/anular', function ($p) {
        Auth::role('superadmin', 'admin');
        $id = (int) $p['id'];
        $motivo = trim((string) (Http::body()['motivo'] ?? ''));
        if (mb_strlen($motivo) < 5) Http::fail(422, 'Indique el motivo de la anulación');

        $m = Db::tx(function () use ($id, $motivo) {
            $m = Db::one('SELECT * FROM movimientos WHERE id = ? FOR UPDATE', [$id]) ?? Http::fail(404, 'Movimiento no encontrado');
            Auth::checkSede($m['sede_id']);
            if ($m['estado'] === 'anulado') Http::fail(409, 'El movimiento ya está anulado');
            Db::exec("UPDATE movimientos SET estado = 'anulado', observacion = ? WHERE id = ?", ["ANULADO: $motivo", $id]);
            if ($m['estado'] === 'activo' && $m['espacio_id']) Db::exec("UPDATE espacios SET estado = 'disponible' WHERE id = ?", [$m['espacio_id']]);
            return $m;
        });
        Audit::log('anular', 'movimiento', $id, ['placa' => $m['placa'], 'valor' => $m['valor'], 'motivo' => $motivo], (int) $m['sede_id']);
        Http::json(['ok' => true]);
    });
};
