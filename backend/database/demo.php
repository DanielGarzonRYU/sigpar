<?php
/**
 * Datos de demostración (DEMO_DATA=true): 2 sedes, usuarios de prueba,
 * espacios, tarifas, abonados y ~2 semanas de movimientos simulados.
 * Útil para la sustentación y para probar reportes. No usar en producción real.
 */
final class DemoData
{
    /**
     * Con la base en la nube (Aiven) cada consulta es un viaje de ida y vuelta de ~0,2 s: por eso se escribe
     * en bloques (espacios y movimientos de a 200 filas) y las tarifas se leen una sola vez. Todo va en una
     * transacción: si la carga se interrumpe no queda a medias y se vuelve a intentar completa.
     */
    public static function seed(): void
    {
        @set_time_limit(0);
        ignore_user_abort(true);
        Db::tx(fn() => self::cargar());
    }

    private const CORREOS_DEMO = ['gerente@sigpar.co', 'operador1@sigpar.co', 'operador2@sigpar.co'];

    /**
     * ¿Quedó a medias una carga de demostración anterior (versiones viejas cargaban sin transacción y podían
     * cortarse a los 30 s)? Solo es "sí" si TODO indica que la base es de demostración: nunca terminó la carga,
     * las únicas sedes son las de demo y no hay más usuarios que el superadministrador y las cuentas de demo.
     */
    public static function incompleta(): bool
    {
        if (Db::value("SELECT id FROM auditoria WHERE accion = 'carga_demo' LIMIT 1")) return false;
        $sedes = array_column(Db::all('SELECT nombre FROM sedes'), 'nombre');
        if (!$sedes || array_diff($sedes, ['Sede Centro', 'Sede Norte'])) return false;
        $otros = (int) Db::value("SELECT COUNT(*) FROM usuarios WHERE rol <> 'superadmin' AND email NOT IN (?,?,?)", self::CORREOS_DEMO);
        return $otros === 0;
    }

    /** Borra lo que dejó una carga de demostración interrumpida, para volver a cargarla completa. */
    public static function limpiarIncompleta(): void
    {
        Db::tx(function () {
            foreach (['movimientos', 'abonado_pagos', 'abonados', 'tarifas', 'espacios', 'usuario_sede'] as $t) Db::exec("DELETE FROM $t");
            Db::exec('DELETE FROM usuarios WHERE email IN (?,?,?)', self::CORREOS_DEMO);
            Db::exec('DELETE FROM sedes');
        });
        error_log('[SIGPAR] Se encontró una carga de demostración incompleta: se limpió para cargarla de nuevo.');
    }

    /** Inserta muchas filas en pocas consultas. */
    private static function enBloque(string $tabla, array $columnas, array $filas, string $extra = ''): void
    {
        foreach (array_chunk($filas, 200) as $bloque) {
            $marcas = '(' . implode(',', array_fill(0, count($columnas), '?')) . ')';
            Db::exec("INSERT INTO $tabla (" . implode(',', $columnas) . ') VALUES ' . implode(',', array_fill(0, count($bloque), $marcas)) . $extra,
                array_merge(...$bloque));
        }
    }

    private static function cargar(): void
    {
        mt_srand(2026);
        $pass = password_hash('Sigpar2026*', PASSWORD_DEFAULT);

        $sedes = [
            ['Sede Centro', 'Cra. 7 # 12-45, Bogotá', '601 555 0101', ['carro' => 24, 'moto' => 12, 'bicicleta' => 6], [4000, 1800, 600], [120000, 60000, 25000], ['fraccion', 'fraccion', 'hora']],
            ['Sede Norte',  'Cl. 140 # 15-20, Bogotá', '601 555 0202', ['carro' => 16, 'moto' => 10, 'bicicleta' => 4], [4500, 2000, 700], [140000, 70000, 30000], ['minuto', 'minuto', 'hora']],
        ];
        $sedeIds = [];
        foreach ($sedes as [$nombre, $dir, $tel, $espacios, $hora, $mes, $modos]) {
            $sid = Db::insert('INSERT INTO sedes (nombre, direccion, telefono) VALUES (?,?,?)', [$nombre, $dir, $tel]);
            $sedeIds[] = $sid;
            $i = 0;
            $filasEsp = [];
            foreach (['carro' => 'C', 'moto' => 'M', 'bicicleta' => 'B'] as $tipo => $pref) {
                for ($n = 1; $n <= $espacios[$tipo]; $n++) $filasEsp[] = [$sid, sprintf('%s-%02d', $pref, $n), $tipo];
            }
            self::enBloque('espacios', ['sede_id', 'codigo', 'tipo_vehiculo'], $filasEsp);
            foreach (['carro', 'moto', 'bicicleta'] as $tipo) {
                Db::exec(
                    'INSERT INTO tarifas (sede_id, tipo_vehiculo, modo_cobro, valor_fraccion, valor_hora, fraccion_minutos, minutos_gracia, tope_dia, valor_mensualidad) VALUES (?,?,?,?,?,?,?,?,?)',
                    [$sid, $tipo, $modos[$i], match ($modos[$i]) { 'minuto' => round($hora[$i] / 60 / 5) * 5, 'hora' => $hora[$i], default => $hora[$i] / 4 },
                     $hora[$i], 15, 5, $hora[$i] * 8, $mes[$i]]
                );
                $i++;
            }
        }

        $usuarios = [
            ['Laura Gómez (Admin)',       'gerente@sigpar.co',   'admin',    $sedeIds],
            ['Carlos Ruiz (Operador)',    'operador1@sigpar.co', 'operador', [$sedeIds[0]]],
            ['Andrea Pérez (Operadora)',  'operador2@sigpar.co', 'operador', [$sedeIds[1]]],
        ];
        $uids = [];
        foreach ($usuarios as [$n, $e, $rol, $ss]) {
            if (Db::value('SELECT id FROM usuarios WHERE email = ?', [$e])) continue;
            $uid = Db::insert('INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?,?,?,?)', [$n, $e, $pass, $rol]);
            foreach ($ss as $s) Db::exec('INSERT INTO usuario_sede (usuario_id, sede_id) VALUES (?,?)', [$uid, $s]);
            $uids[$rol === 'operador' ? $ss[0] : 0] = $uid;
        }

        $nombres = ['Juan Martínez', 'María Rodríguez', 'Pedro Sánchez', 'Ana Torres', 'Luis Herrera', 'Camila Díaz', 'Jorge Castro', 'Valentina Rojas', 'Andrés Moreno', 'Sofía Vargas'];
        $placa = function (string $tipo): string {
            $l = fn() => chr(mt_rand(65, 90));
            return $tipo === 'moto' ? $l() . $l() . $l() . mt_rand(10, 99) . $l() : $l() . $l() . $l() . mt_rand(100, 999);
        };

        // Abonados: algunos vigentes, algunos por vencer y uno vencido
        $abonadosPorSede = [];
        foreach ($sedeIds as $k => $sid) {
            foreach ([25, 12, 3, 1, -4] as $j => $diasFin) {
                $tipo = $j % 3 === 2 ? 'moto' : 'carro';
                $fin = date('Y-m-d', strtotime(sprintf('%+d days', $diasFin)));
                $ini = date('Y-m-d', strtotime("$fin -1 month +1 day"));
                $p = $placa($tipo);
                $nombre = $nombres[($k * 5 + $j) % count($nombres)];
                $aid = Db::insert(
                    'INSERT INTO abonados (sede_id, nombre, documento, telefono, email, placa, tipo_vehiculo, fecha_inicio, fecha_fin, autoriza_datos) VALUES (?,?,?,?,?,?,?,?,?,1)',
                    [$sid, $nombre, (string) mt_rand(10000000, 1099999999), '3' . mt_rand(100000000, 209999999), null, $p, $tipo, $ini, $fin]
                );
                $valor = (float) Parking::tarifa($sid, $tipo)['valor_mensualidad'];
                Db::exec(
                    'INSERT INTO abonado_pagos (abonado_id, sede_id, periodo_inicio, periodo_fin, valor, metodo_pago, usuario_id, created_at) VALUES (?,?,?,?,?,?,?,?)',
                    [$aid, $sid, $ini, $fin, $valor, 'transferencia', $uids[$sid] ?? null, "$ini 09:00:00"]
                );
                $abonadosPorSede[$sid][] = ['id' => $aid, 'placa' => $p, 'tipo' => $tipo];
            }
        }

        // Movimientos históricos (14 días) con más tráfico en horas pico
        $pesosHora = [0,0,0,0,0,1,3,8,9,6,4,4,6,6,4,3,4,6,7,4,2,1,1,0];
        $metodos = ['efectivo', 'efectivo', 'efectivo', 'tarjeta', 'transferencia', 'app'];
        foreach ($sedeIds as $sid) {
            // Tarifas de la sede leídas una vez (antes era una consulta por cada movimiento)
            $tarifas = [];
            foreach (['carro', 'moto', 'bicicleta'] as $t) $tarifas[$t] = Parking::tarifa($sid, $t);
            $historicos = [];
            $espacios = Db::all('SELECT id, tipo_vehiculo FROM espacios WHERE sede_id = ?', [$sid]);
            $porTipo = [];
            foreach ($espacios as $e) $porTipo[$e['tipo_vehiculo']][] = (int) $e['id'];
            $op = $uids[$sid] ?? null;

            for ($d = 14; $d >= 0; $d--) {
                $dia = date('Y-m-d', strtotime("-$d days"));
                $finde = in_array((int) date('N', strtotime($dia)), [6, 7], true);
                $n = mt_rand(18, 32) - ($finde ? 8 : 0);
                // Hoy solo se simulan vehículos que ya salieron (hasta la hora actual)
                $pesos = $d === 0 ? array_slice($pesosHora, 0, max(1, (int) date('G')), true) : $pesosHora;
                if ($d === 0 && array_sum($pesos) === 0) continue;
                for ($i = 0; $i < ($d === 0 ? (int) ($n * array_sum($pesos) / array_sum($pesosHora)) : $n); $i++) {
                    $h = self::pesado($pesos);
                    $tipo = self::pesado(['carro' => 6, 'moto' => 3, 'bicicleta' => 1]);
                    $entrada = sprintf('%s %02d:%02d:00', $dia, $h, mt_rand(0, 59));
                    $salida  = date('Y-m-d H:i:s', strtotime($entrada) + mt_rand(20, 420) * 60);
                    if ($d === 0 && strtotime($salida) > time()) $salida = date('Y-m-d H:i:s', time() - mt_rand(1, 10) * 60);
                    if (strtotime($salida) <= strtotime($entrada)) continue;
                    $esp = $porTipo[$tipo][array_rand($porTipo[$tipo])];
                    $p = $placa($tipo);
                    $calc = Parking::calcular($entrada, $salida, $tarifas[$tipo]);
                    $historicos[] = [$sid, $esp, $p, $tipo, $entrada, $salida, $calc['minutos'], $calc['valor'], $calc['detalle'], $metodos[array_rand($metodos)], 'finalizado', mt_rand(0, 2) ? 'app' : 'web', $op, $op];
                }
            }
            self::enBloque('movimientos', ['sede_id', 'espacio_id', 'placa', 'tipo_vehiculo', 'entrada_at', 'salida_at', 'minutos', 'valor', 'detalle_cobro', 'metodo_pago', 'estado', 'origen', 'usuario_entrada_id', 'usuario_salida_id'], $historicos);

            // Vehículos dentro ahora mismo
            $ahora = time();
            $libres = Db::all("SELECT id, tipo_vehiculo FROM espacios WHERE sede_id = ? AND estado = 'disponible' ORDER BY RAND() LIMIT 12", [$sid]);
            foreach ($libres as $k => $e) {
                $tipo = $e['tipo_vehiculo'];
                $abo = null;
                if ($k === 0) {
                    foreach ($abonadosPorSede[$sid] as $a) if ($a['tipo'] === $tipo && Parking::abonadoVigente($sid, $a['placa'])) { $abo = $a; break; }
                }
                $entrada = date('Y-m-d H:i:s', $ahora - mt_rand(10, 300) * 60);
                Db::exec(
                    "INSERT INTO movimientos (sede_id, espacio_id, placa, tipo_vehiculo, abonado_id, entrada_at, estado, origen, usuario_entrada_id) VALUES (?,?,?,?,?,?, 'activo', ?, ?)",
                    [$sid, $e['id'], $abo['placa'] ?? $placa($tipo), $tipo, $abo['id'] ?? null, $entrada, mt_rand(0, 1) ? 'app' : 'web', $op]
                );
                Db::exec("UPDATE espacios SET estado = 'ocupado' WHERE id = ?", [$e['id']]);
            }
            // Un espacio reservado
            Db::exec("UPDATE espacios SET estado = 'reservado', nota = 'Reservado para visitante' WHERE sede_id = ? AND estado = 'disponible' AND tipo_vehiculo = 'carro' ORDER BY codigo DESC LIMIT 1", [$sid]);
        }

        Audit::log('carga_demo', 'sistema', null, 'Datos de demostración cargados', null, null);
    }

    private static function pesado(array $pesos)
    {
        $total = array_sum($pesos);
        $r = mt_rand(1, $total);
        foreach ($pesos as $k => $w) { if (($r -= $w) <= 0) return $k; }
        return array_key_first($pesos);
    }
}
