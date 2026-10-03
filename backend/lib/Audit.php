<?php
/**
 * Registro de auditoría (requisito: saber quién hizo qué dentro del sistema).
 */
final class Audit
{
    public static function log(string $accion, string $entidad, ?int $entidadId = null, $detalle = null, ?int $sedeId = null, ?int $usuarioId = null): void
    {
        try {
            if ($usuarioId === null) {
                try { $usuarioId = Auth::user()['id']; } catch (Throwable) { $usuarioId = null; }
            }
            Db::exec(
                'INSERT INTO auditoria (usuario_id, sede_id, accion, entidad, entidad_id, detalle, ip) VALUES (?,?,?,?,?,?,?)',
                [
                    $usuarioId, $sedeId, $accion, $entidad, $entidadId,
                    is_string($detalle) || $detalle === null ? $detalle : json_encode($detalle, JSON_UNESCAPED_UNICODE),
                    Http::ip(),
                ]
            );
        } catch (Throwable $e) {
            // La auditoría nunca debe tumbar la operación principal.
            error_log('Auditoría fallida: ' . $e->getMessage());
        }
    }
}
