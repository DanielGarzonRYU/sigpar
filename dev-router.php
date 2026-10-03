<?php
/**
 * Router para el servidor embebido de PHP (solo desarrollo local):
 *   php -S localhost:8080 -t public dev-router.php
 * En producción (Apache/Render) se usa public/api/.htaccess.
 */
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if (str_starts_with($path, '/api')) {
    require __DIR__ . '/public/api/index.php';
    return true;
}
if ($path === '/' || $path === '') {
    require __DIR__ . '/public/index.html';
    return true;
}
// HTML, JS y CSS se revalidan siempre (igual que en producción): así un cambio se ve al recargar,
// sin tener que borrar la caché del navegador.
$archivo = realpath(__DIR__ . '/public' . $path);
$tipos = ['js' => 'text/javascript', 'css' => 'text/css', 'html' => 'text/html'];
$ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
if ($archivo && str_starts_with($archivo, realpath(__DIR__ . '/public')) && is_file($archivo) && isset($tipos[$ext])) {
    $etag = '"' . md5(filemtime($archivo) . filesize($archivo)) . '"';
    header('Cache-Control: no-cache');
    header('ETag: ' . $etag);
    if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); return true; }
    header('Content-Type: ' . $tipos[$ext] . '; charset=utf-8');
    readfile($archivo);
    return true;
}
return false; // demás archivos estáticos
