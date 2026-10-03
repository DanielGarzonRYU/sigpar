<?php
/**
 * Avisos de vencimiento de mensualidades por correo (Brevo, API HTTPS: funciona en Render).
 *
 * - Manual: botón "Avisar por correo" en Abonados (todos los que están por vencer).
 * - Automático: una vez al día (desde las 7 a. m.), aprovechando el ping de UptimeRobot a /api/health.
 *   Cada abonado recibe dos recordatorios: cuando faltan N días (configurable) y el día anterior.
 */
final class Avisos
{
    public static function configurado(): bool
    {
        return (bool) Env::get('BREVO_API_KEY');
    }

    /** Envía los avisos. $soloRecordatorios=true limita a los días N y 1 (modo automático). */
    public static function enviar(array $sedes, bool $soloRecordatorios = false): array
    {
        $d = max(1, (int) Parking::config('dias_alerta_abonados', '5'));
        $cond = $soloRecordatorios
            ? "DATEDIFF(a.fecha_fin, CURDATE()) IN ($d, 1)"
            : "a.fecha_fin BETWEEN CURDATE() AND CURDATE() + INTERVAL $d DAY";
        $lista = Db::all(
            "SELECT a.*, s.nombre AS sede FROM abonados a JOIN sedes s ON s.id = a.sede_id
             WHERE a.activo = 1 AND s.activa = 1 AND a.email IS NOT NULL AND a.email <> ''
               AND a.sede_id IN (" . Db::in($sedes) . ") AND $cond LIMIT 100",
            $sedes ?: [0]
        );

        $empresa = Parking::config('empresa_nombre', 'SIGPAR');
        $enviados = 0; $errores = [];
        foreach ($lista as $a) {
            $html = sprintf(
                '<p>Hola %s,</p><p>Tu mensualidad del vehículo <b>%s</b> en <b>%s</b> vence el <b>%s</b>.</p>'
                . '<p>Acércate a la sede para renovarla y seguir disfrutando del servicio.</p><p>%s</p>',
                htmlspecialchars($a['nombre']), $a['placa'], htmlspecialchars($a['sede']),
                date('d/m/Y', strtotime($a['fecha_fin'])), htmlspecialchars($empresa)
            );
            $ch = curl_init('https://api.brevo.com/v3/smtp/email');
            curl_setopt_array($ch, [
                CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10,
                CURLOPT_HTTPHEADER => ['api-key: ' . Env::get('BREVO_API_KEY'), 'Content-Type: application/json', 'Accept: application/json'],
                CURLOPT_POSTFIELDS => json_encode([
                    'sender' => ['name' => $empresa, 'email' => Env::get('MAIL_FROM', 'no-reply@sigpar.co')],
                    'to' => [['email' => $a['email'], 'name' => $a['nombre']]],
                    'subject' => 'Tu mensualidad vence el ' . date('d/m/Y', strtotime($a['fecha_fin'])),
                    'htmlContent' => $html,
                ]),
            ]);
            curl_exec($ch);
            $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            if ($code >= 200 && $code < 300) $enviados++; else $errores[] = "{$a['placa']}: HTTP $code";
        }
        return ['enviados' => $enviados, 'candidatos' => count($lista), 'errores' => $errores];
    }

    /** Envío automático diario. Se ejecuta como máximo una vez por día aunque lleguen muchos pings a la vez. */
    public static function automaticoDiario(): void
    {
        if (!self::configurado() || Parking::config('avisos_automaticos', '1') !== '1' || (int) date('G') < 7) return;
        $hoy = date('Y-m-d');
        if (Parking::config('avisos_ultimo_envio') === $hoy) return;
        // "Reserva" el día de forma atómica: solo una petición gana
        $gano = Db::exec(
            "UPDATE configuracion SET valor = ? WHERE clave = 'avisos_ultimo_envio' AND (valor IS NULL OR valor <> ?)",
            [$hoy, $hoy]
        );
        if (!$gano) return;
        $sedes = array_map(fn($r) => (int) $r['id'], Db::all('SELECT id FROM sedes WHERE activa = 1'));
        $r = self::enviar($sedes, true);
        Audit::log('notificar', 'abonado', null, ['enviados' => $r['enviados'], 'errores' => count($r['errores']), 'automatico' => true], null, null);
    }
}
