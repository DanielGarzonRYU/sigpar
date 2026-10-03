<?php
/**
 * /dashboard, /reportes/* (OE4) y /auditoria.
 */
return function (Router $r) {

    $rango = function (): array {
        $desde = Http::query('desde', date('Y-m-d', strtotime('-6 days')));
        $hasta = Http::query('hasta', date('Y-m-d'));
        foreach ([$desde, $hasta] as $f) if (!DateTime::createFromFormat('Y-m-d', $f)) Http::fail(422, 'Fecha inválida (use AAAA-MM-DD)');
        if ($desde > $hasta) [$desde, $hasta] = [$hasta, $desde];
        // Protección del servidor: un reporte de muchos años recorre todo el historial.
        if ((strtotime($hasta) - strtotime($desde)) / 86400 > 366) Http::fail(422, 'Seleccione un periodo de máximo 1 año');
        return [$desde, $hasta, "$desde 00:00:00", "$hasta 23:59:59"];
    };

    // -------------------------------------------------------------- DASHBOARD
    $r->get('/dashboard', function () {
        $sedes = Auth::sedeFilter(Http::query('sede_id'));
        $in = Db::in($sedes);
        $hoy = date('Y-m-d');
        $dias = max(1, (int) Parking::config('dias_alerta_abonados', '5'));

        $esp = Db::one(
            "SELECT COUNT(CASE WHEN estado <> 'inactivo' THEN 1 END) capacidad,
                    COUNT(CASE WHEN estado = 'ocupado' THEN 1 END) ocupados,
                    COUNT(CASE WHEN estado = 'disponible' THEN 1 END) disponibles,
                    COUNT(CASE WHEN estado = 'reservado' THEN 1 END) reservados
             FROM espacios WHERE sede_id IN ($in)",
            $sedes
        );
        // Dos consultas separadas (en vez de un OR) para que cada una use su índice por fecha
        $mov = [
            'entradas_hoy' => Db::value("SELECT COUNT(*) FROM movimientos WHERE sede_id IN ($in) AND entrada_at >= ?", array_merge($sedes, ["$hoy 00:00:00"])),
        ] + Db::one(
            "SELECT COUNT(*) salidas_hoy, COALESCE(SUM(valor), 0) ingresos_parqueo_hoy
             FROM movimientos FORCE INDEX (ix_mov_sede_salida) WHERE sede_id IN ($in) AND salida_at >= ? AND estado = 'finalizado'",
            array_merge($sedes, ["$hoy 00:00:00"])
        );
        $mens = (float) Db::value("SELECT COALESCE(SUM(valor),0) FROM abonado_pagos WHERE sede_id IN ($in) AND created_at >= ?", array_merge($sedes, ["$hoy 00:00:00"]));
        $abo = Db::one(
            "SELECT COUNT(CASE WHEN CURDATE() BETWEEN fecha_inicio AND fecha_fin THEN 1 END) vigentes,
                    COUNT(CASE WHEN fecha_fin BETWEEN CURDATE() AND CURDATE() + INTERVAL $dias DAY THEN 1 END) por_vencer
             FROM abonados WHERE activo = 1 AND sede_id IN ($in)",
            $sedes
        );

        // Por sede: consultas agrupadas (GROUP BY sede_id) en lugar de subconsultas por cada sede,
        // porque dentro de subconsultas correlacionadas MySQL elige mal el índice y recorre todo el historial.
        $porSede = Db::all("SELECT id, nombre FROM sedes WHERE id IN ($in) ORDER BY nombre", $sedes);
        $h0 = "$hoy 00:00:00";
        $agrupar = fn(string $sql, array $p) => array_column(Db::all($sql, $p), 'v', 'sede_id');
        $cap = Db::all("SELECT sede_id, COUNT(CASE WHEN estado <> 'inactivo' THEN 1 END) capacidad, COUNT(CASE WHEN estado = 'ocupado' THEN 1 END) ocupados
                        FROM espacios WHERE sede_id IN ($in) GROUP BY sede_id", $sedes);
        $cap = array_column($cap, null, 'sede_id');
        $ent = $agrupar("SELECT sede_id, COUNT(*) v FROM movimientos WHERE sede_id IN ($in) AND entrada_at >= ? GROUP BY sede_id", array_merge($sedes, [$h0]));
        $par = $agrupar("SELECT sede_id, SUM(valor) v FROM movimientos FORCE INDEX (ix_mov_sede_salida) WHERE sede_id IN ($in) AND salida_at >= ? AND estado = 'finalizado' GROUP BY sede_id", array_merge($sedes, [$h0]));
        $men = $agrupar("SELECT sede_id, SUM(valor) v FROM abonado_pagos WHERE sede_id IN ($in) AND created_at >= ? GROUP BY sede_id", array_merge($sedes, [$h0]));
        foreach ($porSede as &$s) {
            $id = $s['id'];
            $s['capacidad'] = (int) ($cap[$id]['capacidad'] ?? 0);
            $s['ocupados'] = (int) ($cap[$id]['ocupados'] ?? 0);
            $s['entradas_hoy'] = (int) ($ent[$id] ?? 0);
            $s['ingresos_hoy'] = (float) ($par[$id] ?? 0) + (float) ($men[$id] ?? 0);
        }
        unset($s);

        // Ingresos de los últimos 7 días
        $desde7 = date('Y-m-d', strtotime('-6 days'));
        $serie = [];
        for ($i = 6; $i >= 0; $i--) $serie[date('Y-m-d', strtotime("-$i days"))] = ['fecha' => date('Y-m-d', strtotime("-$i days")), 'parqueo' => 0, 'mensualidades' => 0];
        foreach (Db::all("SELECT DATE(salida_at) f, SUM(valor) v FROM movimientos FORCE INDEX (ix_mov_sede_salida) WHERE estado='finalizado' AND sede_id IN ($in) AND salida_at >= ? GROUP BY DATE(salida_at)", array_merge($sedes, ["$desde7 00:00:00"])) as $row) {
            if (isset($serie[$row['f']])) $serie[$row['f']]['parqueo'] = (float) $row['v'];
        }
        foreach (Db::all("SELECT DATE(created_at) f, SUM(valor) v FROM abonado_pagos WHERE sede_id IN ($in) AND created_at >= ? GROUP BY DATE(created_at)", array_merge($sedes, ["$desde7 00:00:00"])) as $row) {
            if (isset($serie[$row['f']])) $serie[$row['f']]['mensualidades'] = (float) $row['v'];
        }

        // Entradas por hora (hoy)
        $horas = array_fill(0, 24, 0);
        foreach (Db::all("SELECT HOUR(entrada_at) h, COUNT(*) c FROM movimientos WHERE sede_id IN ($in) AND entrada_at >= ? GROUP BY HOUR(entrada_at)", array_merge($sedes, ["$hoy 00:00:00"])) as $row) {
            $horas[(int) $row['h']] = (int) $row['c'];
        }

        $porTipo = Db::all(
            "SELECT tipo_vehiculo, COUNT(CASE WHEN estado <> 'inactivo' THEN 1 END) capacidad, COUNT(CASE WHEN estado = 'ocupado' THEN 1 END) ocupados
             FROM espacios WHERE sede_id IN ($in) GROUP BY tipo_vehiculo ORDER BY FIELD(tipo_vehiculo,'carro','moto','bicicleta')",
            $sedes
        );

        // Actividad reciente: las 10 últimas entradas y las 10 últimas salidas (cada una por su índice),
        // se mezclan y se toman los 10 eventos más nuevos.
        $campos = "m.id, m.placa, m.tipo_vehiculo, m.estado, m.entrada_at, m.salida_at, m.valor, m.origen, m.propietario, m.abonado_id,
                          a.nombre abonado, s.nombre sede, e.codigo espacio
                   FROM movimientos m JOIN sedes s ON s.id = m.sede_id LEFT JOIN espacios e ON e.id = m.espacio_id
                   LEFT JOIN abonados a ON a.id = m.abonado_id";
        $desde2 = date('Y-m-d H:i:s', strtotime('-7 days'));
        $recientes = array_merge(
            Db::all("SELECT $campos WHERE m.sede_id IN ($in) AND m.entrada_at >= ? ORDER BY m.entrada_at DESC LIMIT 10", array_merge($sedes, [$desde2])),
            Db::all("SELECT $campos WHERE m.sede_id IN ($in) AND m.salida_at >= ? ORDER BY m.salida_at DESC LIMIT 10", array_merge($sedes, [$desde2]))
        );
        $momento = fn($m) => max($m['entrada_at'], $m['salida_at'] ?? '');
        usort($recientes, fn($a, $b) => strcmp($momento($b), $momento($a)));
        $vistos = [];
        $recientes = array_slice(array_values(array_filter($recientes, function ($m) use (&$vistos) {
            if (isset($vistos[$m['id']])) return false;
            return $vistos[$m['id']] = true;
        })), 0, 10);

        Http::json([
            'ok' => true,
            'actualizado' => date('Y-m-d H:i:s'),
            'kpis' => [
                'capacidad' => (int) $esp['capacidad'], 'ocupados' => (int) $esp['ocupados'],
                'disponibles' => (int) $esp['disponibles'], 'reservados' => (int) $esp['reservados'],
                'entradas_hoy' => (int) $mov['entradas_hoy'], 'salidas_hoy' => (int) $mov['salidas_hoy'],
                'ingresos_parqueo_hoy' => (float) $mov['ingresos_parqueo_hoy'], 'ingresos_mensualidades_hoy' => $mens,
                'ingresos_hoy' => (float) $mov['ingresos_parqueo_hoy'] + $mens,
                'abonados_vigentes' => (int) $abo['vigentes'], 'abonados_por_vencer' => (int) $abo['por_vencer'],
            ],
            'por_sede' => $porSede,
            'ingresos_7dias' => array_values($serie),
            'entradas_por_hora' => $horas,
            'por_tipo' => $porTipo,
            'recientes' => $recientes,
        ]);
    });

    // ---------------------------------------------------------------- RECAUDO
    $r->get('/reportes/recaudo', function () use ($rango) {
        Auth::role('superadmin', 'admin');
        [$desde, $hasta, $d0, $d1] = $rango();
        $sedes = Auth::sedeFilter(Http::query('sede_id'));
        $in = Db::in($sedes);

        $parqueo = Db::all(
            "SELECT DATE(m.salida_at) fecha, s.nombre sede, COUNT(*) cantidad, SUM(m.valor) total
             FROM movimientos m FORCE INDEX (ix_mov_sede_salida) JOIN sedes s ON s.id = m.sede_id
             WHERE m.estado = 'finalizado' AND m.sede_id IN ($in) AND m.salida_at BETWEEN ? AND ?
             GROUP BY DATE(m.salida_at), s.nombre ORDER BY fecha, sede",
            array_merge($sedes, [$d0, $d1])
        );
        $mensual = Db::all(
            "SELECT DATE(p.created_at) fecha, s.nombre sede, COUNT(*) cantidad, SUM(p.valor) total
             FROM abonado_pagos p JOIN sedes s ON s.id = p.sede_id
             WHERE p.sede_id IN ($in) AND p.created_at BETWEEN ? AND ?
             GROUP BY DATE(p.created_at), s.nombre ORDER BY fecha, sede",
            array_merge($sedes, [$d0, $d1])
        );
        // Unir ambas fuentes por (fecha, sede)
        $filas = [];
        foreach ($parqueo as $p) {
            $k = $p['fecha'] . '|' . $p['sede'];
            $filas[$k] = ['fecha' => $p['fecha'], 'sede' => $p['sede'], 'vehiculos' => (int) $p['cantidad'], 'parqueo' => (float) $p['total'], 'mensualidades' => 0.0];
        }
        foreach ($mensual as $p) {
            $k = $p['fecha'] . '|' . $p['sede'];
            $filas[$k] ??= ['fecha' => $p['fecha'], 'sede' => $p['sede'], 'vehiculos' => 0, 'parqueo' => 0.0, 'mensualidades' => 0.0];
            $filas[$k]['mensualidades'] = (float) $p['total'];
        }
        ksort($filas);
        foreach ($filas as &$f) $f['total'] = $f['parqueo'] + $f['mensualidades'];

        $porMetodo = Db::all(
            "SELECT metodo_pago metodo, COUNT(*) cantidad, SUM(valor) total FROM (
                SELECT metodo_pago, valor FROM movimientos FORCE INDEX (ix_mov_sede_salida) WHERE estado = 'finalizado' AND sede_id IN ($in) AND salida_at BETWEEN ? AND ?
                UNION ALL
                SELECT metodo_pago, valor FROM abonado_pagos WHERE sede_id IN ($in) AND created_at BETWEEN ? AND ?
             ) x GROUP BY metodo_pago ORDER BY total DESC",
            array_merge($sedes, [$d0, $d1], $sedes, [$d0, $d1])
        );
        $porTipo = Db::all(
            "SELECT tipo_vehiculo tipo, COUNT(*) cantidad, SUM(valor) total, ROUND(AVG(minutos)) minutos_promedio
             FROM movimientos FORCE INDEX (ix_mov_sede_salida) WHERE estado = 'finalizado' AND sede_id IN ($in) AND salida_at BETWEEN ? AND ?
             GROUP BY tipo_vehiculo",
            array_merge($sedes, [$d0, $d1])
        );
        $anulados = (int) Db::value("SELECT COUNT(*) FROM movimientos WHERE estado = 'anulado' AND sede_id IN ($in) AND entrada_at BETWEEN ? AND ?", array_merge($sedes, [$d0, $d1]));

        Http::json([
            'ok' => true, 'desde' => $desde, 'hasta' => $hasta,
            'filas' => array_values($filas), 'por_metodo' => $porMetodo, 'por_tipo' => $porTipo,
            'totales' => [
                'parqueo' => array_sum(array_column($filas, 'parqueo')),
                'mensualidades' => array_sum(array_column($filas, 'mensualidades')),
                'total' => array_sum(array_column($filas, 'total')),
                'vehiculos' => array_sum(array_column($filas, 'vehiculos')),
                'anulados' => $anulados,
            ],
        ]);
    });

    // ------------------------------------------------------------- HORAS PICO
    $r->get('/reportes/horas-pico', function () use ($rango) {
        Auth::role('superadmin', 'admin');
        [$desde, $hasta, $d0, $d1] = $rango();
        $sedes = Auth::sedeFilter(Http::query('sede_id'));
        $in = Db::in($sedes);
        $params = array_merge($sedes, [$d0, $d1]);

        $horas = array_fill(0, 24, 0);
        foreach (Db::all("SELECT HOUR(entrada_at) h, COUNT(*) c FROM movimientos WHERE estado <> 'anulado' AND sede_id IN ($in) AND entrada_at BETWEEN ? AND ? GROUP BY HOUR(entrada_at)", $params) as $row) {
            $horas[(int) $row['h']] = (int) $row['c'];
        }
        // DAYOFWEEK: 1=domingo … 7=sábado → se reordena de lunes a domingo
        $dias = array_fill(0, 7, 0);
        foreach (Db::all("SELECT DAYOFWEEK(entrada_at) d, COUNT(*) c FROM movimientos WHERE estado <> 'anulado' AND sede_id IN ($in) AND entrada_at BETWEEN ? AND ? GROUP BY DAYOFWEEK(entrada_at)", $params) as $row) {
            $dias[((int) $row['d'] + 5) % 7] = (int) $row['c'];
        }
        Http::json(['ok' => true, 'desde' => $desde, 'hasta' => $hasta, 'por_hora' => $horas, 'por_dia' => $dias,
            'dias_semana' => ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']]);
    });

    // ---------------------------------------------------------- CIERRE DE CAJA
    $r->get('/reportes/caja', function () {
        Auth::user();
        $fecha = Http::query('fecha', date('Y-m-d'));
        if (!DateTime::createFromFormat('Y-m-d', $fecha)) Http::fail(422, 'Fecha inválida');
        $sedes = Auth::sedeFilter(Http::query('sede_id'));
        $in = Db::in($sedes);
        $d0 = "$fecha 00:00:00"; $d1 = "$fecha 23:59:59";

        $resumen = Db::all(
            "SELECT usuario, sede, metodo, COUNT(*) cantidad, SUM(valor) total FROM (
                SELECT COALESCE(u.nombre,'Usuario eliminado') usuario, s.nombre sede, m.metodo_pago metodo, m.valor
                  FROM movimientos m FORCE INDEX (ix_mov_sede_salida) JOIN sedes s ON s.id = m.sede_id LEFT JOIN usuarios u ON u.id = m.usuario_salida_id
                 WHERE m.estado = 'finalizado' AND m.sede_id IN ($in) AND m.salida_at BETWEEN ? AND ?
                UNION ALL
                SELECT COALESCE(u.nombre,'Usuario eliminado'), s.nombre, CONCAT('mensualidad_', p.metodo_pago), p.valor
                  FROM abonado_pagos p JOIN sedes s ON s.id = p.sede_id LEFT JOIN usuarios u ON u.id = p.usuario_id
                 WHERE p.sede_id IN ($in) AND p.created_at BETWEEN ? AND ?
             ) x GROUP BY usuario, sede, metodo ORDER BY sede, usuario, metodo",
            array_merge($sedes, [$d0, $d1], $sedes, [$d0, $d1])
        );
        $total = array_sum(array_column($resumen, 'total'));
        $efectivo = array_sum(array_map(fn($r) => str_ends_with($r['metodo'], 'efectivo') ? (float) $r['total'] : 0, $resumen));
        Http::json(['ok' => true, 'fecha' => $fecha, 'resumen' => $resumen, 'total' => $total, 'efectivo' => $efectivo]);
    });

    // ------------------------------------ INDICADORES DEL MARCO LÓGICO (SMART)
    $r->get('/reportes/indicadores', function () use ($rango) {
        Auth::role('superadmin', 'admin');
        [$desde, $hasta, $d0, $d1] = $rango();
        $sedes = Auth::sedeFilter(Http::query('sede_id'));
        $in = Db::in($sedes);
        $p = array_merge($sedes, [$d0, $d1]);

        $mov = Db::one(
            "SELECT COUNT(*) total,
                    COUNT(CASE WHEN estado = 'finalizado' THEN 1 END) cobrados,
                    COUNT(CASE WHEN estado = 'anulado' THEN 1 END) anulados,
                    COUNT(CASE WHEN origen = 'app' THEN 1 END) desde_app,
                    ROUND(AVG(CASE WHEN estado = 'finalizado' THEN minutos END)) estancia
             FROM movimientos WHERE sede_id IN ($in) AND entrada_at BETWEEN ? AND ?",
            $p
        );
        // Mismo periodo anterior, para comparar la tendencia de errores (indicador del Fin)
        $dias = (int) ((strtotime($hasta) - strtotime($desde)) / 86400) + 1;
        $a0 = date('Y-m-d 00:00:00', strtotime("$desde -$dias days"));
        $a1 = date('Y-m-d 23:59:59', strtotime("$desde -1 day"));
        $prev = Db::one(
            "SELECT COUNT(*) total, COUNT(CASE WHEN estado = 'anulado' THEN 1 END) anulados
             FROM movimientos WHERE sede_id IN ($in) AND entrada_at BETWEEN ? AND ?",
            array_merge($sedes, [$a0, $a1])
        );
        $abo = Db::one(
            "SELECT COUNT(*) total,
                    COUNT(CASE WHEN (email IS NOT NULL AND email <> '') OR (telefono IS NOT NULL AND telefono <> '') THEN 1 END) con_aviso
             FROM abonados WHERE activo = 1 AND sede_id IN ($in) AND fecha_fin >= CURDATE()",
            $sedes
        );
        $pct = fn($a, $b) => $b ? round($a * 100 / $b, 1) : null;

        Http::json([
            'ok' => true, 'desde' => $desde, 'hasta' => $hasta,
            'movimientos' => array_map('intval', $mov),
            'errores_pct' => $pct((int) $mov['anulados'], (int) $mov['total']),
            'errores_pct_anterior' => $pct((int) $prev['anulados'], (int) $prev['total']),
            'cobros_automaticos_pct' => (int) $mov['cobrados'] ? 100.0 : null,
            'abonados' => array_map('intval', $abo),
            'abonados_aviso_pct' => $pct((int) $abo['con_aviso'], (int) $abo['total']),
            'app_pct' => $pct((int) $mov['desde_app'], (int) $mov['total']),
        ]);
    });

    // -------------------------------------------------- COMPARATIVO DE SEDES
    $r->get('/reportes/comparativo', function () use ($rango) {
        Auth::role('superadmin', 'admin');
        [$desde, $hasta, $d0, $d1] = $rango();
        $sedes = Auth::sedeFilter(null);
        $in = Db::in($sedes);
        // Consultas agrupadas por sede (una pasada por índice cada una) en lugar de subconsultas por sede
        $rows = Db::all("SELECT id, nombre FROM sedes WHERE id IN ($in) ORDER BY nombre", $sedes);
        $porSede = fn(string $sql, array $p) => array_column(Db::all($sql, $p), null, 'sede_id');
        $esp = $porSede("SELECT sede_id, COUNT(CASE WHEN estado <> 'inactivo' THEN 1 END) capacidad, COUNT(CASE WHEN estado = 'ocupado' THEN 1 END) ocupados
                         FROM espacios WHERE sede_id IN ($in) GROUP BY sede_id", $sedes);
        $sal = $porSede("SELECT sede_id, COUNT(*) vehiculos, SUM(valor) parqueo, ROUND(AVG(minutos)) minutos_promedio
                         FROM movimientos FORCE INDEX (ix_mov_sede_salida) WHERE sede_id IN ($in) AND salida_at BETWEEN ? AND ? AND estado = 'finalizado' GROUP BY sede_id",
                         array_merge($sedes, [$d0, $d1]));
        $anu = $porSede("SELECT sede_id, COUNT(*) anulados FROM movimientos WHERE sede_id IN ($in) AND entrada_at BETWEEN ? AND ? AND estado = 'anulado' GROUP BY sede_id",
                         array_merge($sedes, [$d0, $d1]));
        $men = $porSede("SELECT sede_id, SUM(valor) mensualidades FROM abonado_pagos WHERE sede_id IN ($in) AND created_at BETWEEN ? AND ? GROUP BY sede_id",
                         array_merge($sedes, [$d0, $d1]));
        $abo = $porSede("SELECT sede_id, COUNT(*) abonados_vigentes FROM abonados WHERE sede_id IN ($in) AND activo = 1 AND CURDATE() BETWEEN fecha_inicio AND fecha_fin GROUP BY sede_id", $sedes);
        foreach ($rows as &$s) {
            $id = $s['id'];
            $s += [
                'capacidad' => (int) ($esp[$id]['capacidad'] ?? 0), 'ocupados' => (int) ($esp[$id]['ocupados'] ?? 0),
                'vehiculos' => (int) ($sal[$id]['vehiculos'] ?? 0), 'parqueo' => (float) ($sal[$id]['parqueo'] ?? 0),
                'minutos_promedio' => (int) ($sal[$id]['minutos_promedio'] ?? 0), 'mensualidades' => (float) ($men[$id]['mensualidades'] ?? 0),
                'abonados_vigentes' => (int) ($abo[$id]['abonados_vigentes'] ?? 0), 'anulados' => (int) ($anu[$id]['anulados'] ?? 0),
            ];
        }
        unset($s);
        foreach ($rows as &$s) {
            $s['total'] = (float) $s['parqueo'] + (float) $s['mensualidades'];
            $s['ticket_promedio'] = $s['vehiculos'] ? round((float) $s['parqueo'] / $s['vehiculos']) : 0;
            $s['ocupacion_pct'] = $s['capacidad'] ? round($s['ocupados'] * 100 / $s['capacidad']) : 0;
        }
        Http::json(['ok' => true, 'desde' => $desde, 'hasta' => $hasta, 'sedes' => $rows]);
    });

    // -------------------------------------------------------------- AUDITORÍA
    $r->get('/auditoria', function () use ($rango) {
        Auth::role('superadmin', 'admin');
        [$desde, $hasta, $d0, $d1] = $rango();
        $where = ['a.created_at BETWEEN ? AND ?'];
        $params = [$d0, $d1];

        $sedeQ = Http::query('sede_id');
        if (Auth::isSuper() && !$sedeQ) {
            // el superadmin ve también eventos globales (sin sede)
        } else {
            $sedes = Auth::sedeFilter($sedeQ);
            $where[] = 'a.sede_id IN (' . Db::in($sedes) . ')';
            $params = array_merge($params, $sedes);
        }
        if ($u = Http::query('usuario_id')) { $where[] = 'a.usuario_id = ?'; $params[] = (int) $u; }

        // Resumen del periodo (antes del filtro por categoría) para detectar acciones sensibles
        $wBase = implode(' AND ', $where);
        $resumen = Db::one(
            "SELECT COUNT(CASE WHEN accion = 'entrada' THEN 1 END) entradas,
                    COUNT(CASE WHEN accion = 'salida' THEN 1 END) salidas,
                    COUNT(CASE WHEN accion = 'anular' THEN 1 END) anulaciones,
                    COUNT(CASE WHEN accion = 'login_fallido' THEN 1 END) ingresos_fallidos,
                    COUNT(CASE WHEN entidad IN ('tarifas','espacio','sede','configuracion') THEN 1 END) cambios_config
             FROM auditoria a WHERE $wBase",
            $params
        );

        // Categorías comprensibles en lugar de nombres técnicos
        $cat = Http::query('categoria');
        $categorias = [
            'operacion'     => "a.entidad = 'movimiento'",
            'abonados'      => "a.entidad = 'abonado'",
            'configuracion' => "a.entidad IN ('tarifas','espacio','sede','configuracion')",
            'accesos'       => "a.entidad = 'usuario'",
            'sensibles'     => "a.accion IN ('anular','login_fallido','desactivar','eliminar','ajustar_capacidad','cambiar_password') OR a.entidad IN ('tarifas','configuracion')",
        ];
        if ($cat && isset($categorias[$cat])) $where[] = '(' . $categorias[$cat] . ')';

        $w = implode(' AND ', $where);
        $limit = min(5000, max(1, (int) Http::query('limit', 100)));
        $page  = max(1, (int) Http::query('page', 1));
        $total = (int) Db::value("SELECT COUNT(*) FROM auditoria a WHERE $w", $params);
        $rows = Db::all(
            "SELECT a.*, u.nombre usuario, u.rol, s.nombre sede FROM auditoria a
             LEFT JOIN usuarios u ON u.id = a.usuario_id LEFT JOIN sedes s ON s.id = a.sede_id
             WHERE $w ORDER BY a.id DESC LIMIT $limit OFFSET " . (($page - 1) * $limit),
            $params
        );
        Http::json(['ok' => true, 'registros' => $rows, 'total' => $total, 'page' => $page, 'limit' => $limit,
            'resumen' => array_map('intval', $resumen ?? [])]);
    });
};
