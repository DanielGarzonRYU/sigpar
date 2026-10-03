<?php
/**
 * Router mínimo: rutas del tipo "GET /movimientos/{id}".
 */
final class Router
{
    private array $routes = [];

    public function add(string $method, string $pattern, callable $handler): void
    {
        $regex = '#^' . preg_replace('#\{(\w+)\}#', '(?P<$1>[^/]+)', rtrim($pattern, '/')) . '/?$#';
        $this->routes[] = [$method, $regex, $handler];
    }

    public function get(string $p, callable $h): void    { $this->add('GET', $p, $h); }
    public function post(string $p, callable $h): void   { $this->add('POST', $p, $h); }
    public function put(string $p, callable $h): void    { $this->add('PUT', $p, $h); }
    public function patch(string $p, callable $h): void  { $this->add('PATCH', $p, $h); }
    public function delete(string $p, callable $h): void { $this->add('DELETE', $p, $h); }

    public function dispatch(string $method, string $path): void
    {
        // HEAD se atiende como GET (el servidor web descarta el cuerpo). Monitores como UptimeRobot
        // usan HEAD: si respondiera 405 marcarían el sistema como caído y /health no mantendría despierta la BD.
        if ($method === 'HEAD') $method = 'GET';
        $path = '/' . trim($path, '/');
        $allowed = false;
        foreach ($this->routes as [$m, $regex, $handler]) {
            if (!preg_match($regex, $path, $match)) continue;
            $allowed = true;
            if ($m !== $method) continue;
            $params = array_filter($match, 'is_string', ARRAY_FILTER_USE_KEY);
            $handler($params);
            return;
        }
        Http::fail($allowed ? 405 : 404, $allowed ? 'Método no permitido' : 'Ruta no encontrada');
    }
}
