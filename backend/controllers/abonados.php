<?php
/**
 * /abonados — clientes con mensualidad y alertas de vencimiento (OE3).
 */
return function (Router $r) {

    $diasAlerta = fn(): int => max(1, (int) Parking::config('dias_alerta_abonados', '5'));

    $cargar = function (int $id): array {
        $a = Db::one('SELECT * FROM abonados WHERE id = ?', [$id]) ?? Http::fail(404, 'Abonado no encontrado');
        Auth::checkSede($a['sede_id']);
        return $a;
    };

    $finPeriodo = fn(string $inicio, int $meses): string =>
        (new DateTime($inicio))->modify("+$meses month")->modify('-1 day')->format('Y-m-d');

    /**
     * Valor de la mensualidad: por defecto, la tarifa de la sede × meses (cobro automático).
     * Solo un administrador puede fijar otro valor (descuento o convenio); nunca negativo. Queda en auditoría.
     */
    $valorMensualidad = function (array $b, ?array $tarifa, int $meses): float {
        $base = (float) ($tarifa['valor_mensualidad'] ?? 0) * $meses;
        if (!isset($b['valor']) || $b['valor'] === '') return $base;
        $v = (float) $b['valor'];
        if (abs($v - $base) < 0.01) return $base;
        if (!in_array(Auth::user()['rol'], ['superadmin', 'admin'], true)) {
            Http::fail(403, 'Solo un administrador puede cambiar el valor de la mensualidad');
        }
        if ($v < 0) Http::fail(422, 'El valor no puede ser negativo');
        return $v;
    };

    $estadoSql = function (int $dias): string {
        return "CASE
            WHEN a.activo = 0 THEN 'inactivo'
            WHEN a.fecha_fin < CURDATE() THEN 'vencido'
            WHEN a.fecha_inicio > CURDATE() THEN 'programado'
            WHEN a.fecha_fin <= CURDATE() + INTERVAL $dias DAY THEN 'por_vencer'
            ELSE 'vigente' END";
    };

    $r->get('/abonados', function () use ($estadoSql, $diasAlerta) {
        $sedes = Auth::sedeFilter(Http::query('sede_id'));
        $where = ['a.sede_id IN (' . Db::in($sedes) . ')'];
        $params = $sedes;
        if ($q = Http::query('q')) {
            $where[] = '(a.nombre LIKE ? OR a.placa LIKE ? OR a.documento LIKE ?)';
            array_push($params, "%$q%", '%' . strtoupper($q) . '%', "%$q%");
        }
        $estado = $estadoSql($diasAlerta());
        $sql = "SELECT a.*, s.nombre AS sede, $estado AS estado, DATEDIFF(a.fecha_fin, CURDATE()) AS dias_restantes
                FROM abonados a JOIN sedes s ON s.id = a.sede_id WHERE " . implode(' AND ', $where);
        if ($f = Http::query('estado')) { $sql = "SELECT * FROM ($sql) x WHERE x.estado = ?"; $params[] = $f; }
        Http::json(['ok' => true, 'abonados' => Db::all("$sql ORDER BY fecha_fin", $params)]);
    });

    // Alertas: abonados por vencer o vencidos en los últimos 15 días.
    $r->get('/abonados/alertas', function () use ($diasAlerta) {
        $sedes = Auth::sedeFilter(Http::query('sede_id'));
        $d = $diasAlerta();
        $rows = Db::all(
            "SELECT a.id, a.nombre, a.placa, a.telefono, a.email, a.fecha_fin, a.sede_id, s.nombre AS sede,
                    DATEDIFF(a.fecha_fin, CURDATE()) AS dias_restantes
             FROM abonados a JOIN sedes s ON s.id = a.sede_id
             WHERE a.activo = 1 AND a.sede_id IN (" . Db::in($sedes) . ")
               AND a.fecha_fin BETWEEN CURDATE() - INTERVAL 15 DAY AND CURDATE() + INTERVAL $d DAY
             ORDER BY a.fecha_fin",
            $sedes
        );
        Http::json(['ok' => true, 'alertas' => $rows, 'dias_alerta' => $d]);
    });

    $r->get('/abonados/{id}', function ($p) use ($cargar) {
        $a = $cargar((int) $p['id']);
        $pagos = Db::all(
            'SELECT p.*, u.nombre AS usuario FROM abonado_pagos p LEFT JOIN usuarios u ON u.id = p.usuario_id
             WHERE p.abonado_id = ? ORDER BY p.created_at DESC',
            [$a['id']]
        );
        Http::json(['ok' => true, 'abonado' => $a, 'pagos' => $pagos]);
    });

    $r->post('/abonados', function () use ($finPeriodo, $valorMensualidad) {
        $u = Auth::user();
        $b = Http::body();
        Http::require($b, ['sede_id', 'nombre', 'placa', 'tipo_vehiculo']);
        if (empty($b['autoriza_datos'])) Http::fail(422, 'Se requiere la autorización de tratamiento de datos personales (Ley 1581 de 2012)');
        $sede   = Auth::checkSede($b['sede_id']);
        $placa  = Parking::placa($b['placa']);
        $tipo   = Parking::tipo($b['tipo_vehiculo']);
        $meses  = min(12, max(1, (int) ($b['meses'] ?? 1)));
        $inicio = $b['fecha_inicio'] ?? date('Y-m-d');
        if (!DateTime::createFromFormat('Y-m-d', $inicio)) Http::fail(422, 'Fecha de inicio inválida');
        $fin    = $finPeriodo($inicio, $meses);
        $previo = Db::one('SELECT nombre, activo FROM abonados WHERE sede_id = ? AND placa = ?', [$sede, $placa]);
        if ($previo) {
            Http::fail(409, "La placa $placa ya está inscrita en esta sede a nombre de {$previo['nombre']}"
                . ($previo['activo'] ? '' : ' (inactivo)') . '. Búsquela en la lista y use "Renovar".');
        }
        $tarifa = Parking::tarifa($sede, $tipo);
        $valor  = $valorMensualidad($b, $tarifa, $meses);
        $metodo = in_array($b['metodo_pago'] ?? '', Parking::METODOS_PAGO, true) ? $b['metodo_pago'] : 'efectivo';

        $id = Db::tx(function () use ($b, $sede, $placa, $tipo, $inicio, $fin, $valor, $metodo, $u) {
            $id = Db::insert(
                'INSERT INTO abonados (sede_id, nombre, documento, telefono, email, placa, tipo_vehiculo, fecha_inicio, fecha_fin, autoriza_datos)
                 VALUES (?,?,?,?,?,?,?,?,?,1)',
                [$sede, trim($b['nombre']), $b['documento'] ?? null, $b['telefono'] ?? null, $b['email'] ?? null, $placa, $tipo, $inicio, $fin]
            );
            Db::exec(
                'INSERT INTO abonado_pagos (abonado_id, sede_id, periodo_inicio, periodo_fin, valor, metodo_pago, usuario_id) VALUES (?,?,?,?,?,?,?)',
                [$id, $sede, $inicio, $fin, $valor, $metodo, $u['id']]
            );
            return $id;
        });
        Audit::log('crear', 'abonado', $id, ['placa' => $placa, 'hasta' => $fin, 'valor' => $valor], $sede);
        Http::json(['ok' => true, 'id' => $id, 'fecha_fin' => $fin, 'valor' => $valor], 201);
    });

    $r->put('/abonados/{id}', function ($p) use ($cargar) {
        Auth::role('superadmin', 'admin');
        $a = $cargar((int) $p['id']);
        $b = Http::body();
        Http::require($b, ['nombre', 'placa', 'tipo_vehiculo']);
        Db::exec(
            'UPDATE abonados SET nombre = ?, documento = ?, telefono = ?, email = ?, placa = ?, tipo_vehiculo = ? WHERE id = ?',
            [trim($b['nombre']), $b['documento'] ?? null, $b['telefono'] ?? null, $b['email'] ?? null, Parking::placa($b['placa']), Parking::tipo($b['tipo_vehiculo']), $a['id']]
        );
        Audit::log('editar', 'abonado', (int) $a['id'], $b, (int) $a['sede_id']);
        Http::json(['ok' => true]);
    });

    // Renovar: el nuevo periodo empieza al día siguiente del vencimiento (o hoy, si ya venció).
    $r->post('/abonados/{id}/renovar', function ($p) use ($cargar, $finPeriodo, $valorMensualidad) {
        $u = Auth::user();
        $a = $cargar((int) $p['id']);
        $b = Http::body();
        $meses  = min(12, max(1, (int) ($b['meses'] ?? 1)));
        $inicio = max(date('Y-m-d'), (new DateTime($a['fecha_fin']))->modify('+1 day')->format('Y-m-d'));
        $fin    = $finPeriodo($inicio, $meses);
        $tarifa = Parking::tarifa((int) $a['sede_id'], $a['tipo_vehiculo']);
        $valor  = $valorMensualidad($b, $tarifa, $meses);
        $metodo = in_array($b['metodo_pago'] ?? '', Parking::METODOS_PAGO, true) ? $b['metodo_pago'] : 'efectivo';

        Db::tx(function () use ($a, $inicio, $fin, $valor, $metodo, $u) {
            Db::exec('UPDATE abonados SET fecha_fin = ?, activo = 1 WHERE id = ?', [$fin, $a['id']]);
            Db::exec(
                'INSERT INTO abonado_pagos (abonado_id, sede_id, periodo_inicio, periodo_fin, valor, metodo_pago, usuario_id) VALUES (?,?,?,?,?,?,?)',
                [$a['id'], $a['sede_id'], $inicio, $fin, $valor, $metodo, $u['id']]
            );
        });
        Audit::log('renovar', 'abonado', (int) $a['id'], ['placa' => $a['placa'], 'hasta' => $fin, 'valor' => $valor], (int) $a['sede_id']);
        Http::json(['ok' => true, 'fecha_fin' => $fin, 'valor' => $valor]);
    });

    $r->patch('/abonados/{id}/estado', function ($p) use ($cargar) {
        Auth::role('superadmin', 'admin');
        $a = $cargar((int) $p['id']);
        $activo = !empty(Http::body()['activo']) ? 1 : 0;
        Db::exec('UPDATE abonados SET activo = ? WHERE id = ?', [$activo, $a['id']]);
        Audit::log($activo ? 'activar' : 'desactivar', 'abonado', (int) $a['id'], null, (int) $a['sede_id']);
        Http::json(['ok' => true]);
    });

    // Aviso por correo a los abonados por vencer (ver lib/Avisos.php; también hay envío automático diario).
    $r->post('/abonados/notificar', function () {
        Auth::role('superadmin', 'admin');
        if (!Avisos::configurado()) Http::fail(501, 'El envío de correos no está configurado (falta BREVO_API_KEY)');
        $res = Avisos::enviar(Auth::sedeFilter(Http::body()['sede_id'] ?? null));
        Audit::log('notificar', 'abonado', null, ['enviados' => $res['enviados'], 'errores' => count($res['errores'])]);
        Http::json(['ok' => true] + $res);
    });
};
