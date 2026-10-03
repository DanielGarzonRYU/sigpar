<?php
/**
 * Punto de arranque de la API SIGPAR (compartida por la web y la app Android).
 */
declare(strict_types=1);

foreach (['Env', 'Http', 'Db', 'Jwt', 'Router', 'Auth', 'Audit', 'Parking', 'Avisos', 'Ia', 'Migrator'] as $cls) {
    require_once __DIR__ . "/lib/$cls.php";
}

Env::load(__DIR__ . '/../.env');
date_default_timezone_set('America/Bogota');
ini_set('display_errors', '0');

function sigpar_cors(): void
{
    $origin  = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed = array_filter(array_map('trim', explode(',', Env::get('ALLOWED_ORIGINS', ''))));
    if ($origin && ($allowed === ['*'] || in_array($origin, $allowed, true))) {
        header("Access-Control-Allow-Origin: $origin");
        header('Vary: Origin');
        header('Access-Control-Allow-Headers: Authorization, Content-Type');
        header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
        header('Access-Control-Max-Age: 86400');
    }
}

function sigpar_run(string $path): void
{
    sigpar_cors();
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-store');

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'OPTIONS') { http_response_code(204); return; }

    try {
        Migrator::runIfNeeded();

        $router = new Router();
        foreach (glob(__DIR__ . '/controllers/*.php') as $file) {
            (require $file)($router);
        }
        $router->dispatch($method, $path);
    } catch (HttpError $e) {
        Http::json(['ok' => false, 'error' => $e->getMessage()] + $e->extra, $e->status);
    } catch (PDOException $e) {
        error_log('[SIGPAR] BD: ' . $e->getMessage());
        $dup = ($e->errorInfo[1] ?? 0) === 1062;
        Http::json(
            ['ok' => false, 'error' => $dup ? 'Ya existe un registro con esos datos' : 'Error de base de datos'],
            $dup ? 409 : 500
        );
    } catch (Throwable $e) {
        error_log('[SIGPAR] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
        Http::json(['ok' => false, 'error' => 'Error interno del servidor'], 500);
    }
}
