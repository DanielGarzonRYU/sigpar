<?php
// Todas las peticiones /api/* llegan aquí (ver .htaccess).
require __DIR__ . '/../../backend/bootstrap.php';

$uri  = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$path = preg_replace('#^.*?/api#', '', $uri, 1);
sigpar_run($path ?: '/');
