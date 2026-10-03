# SIGPAR — Sistema de Gestión de Parqueaderos (Web)

Proyecto de **César Cristancho** · Portafolio: <https://cesarcristancho.pages.dev/#proyectos>

Plataforma web del proyecto SIGPAR (Universidad ECCI, 2026). Comparte **la misma API y la misma base de datos MySQL** con la futura app Android del operador: lo que se registra en una se ve en la otra en segundos.

## Qué incluye

- **Multi-sede**: cada sede con sus espacios, tarifas, abonados, operadores y reportes. El superadministrador ve todas y las compara.
- **Roles**: Superadministrador, Administrador (una o varias sedes) y Operador (una sede). Autenticación con JWT y contraseñas cifradas.
- **Dashboard en tiempo real**: ocupación, ingresos del día, entradas por hora y actividad reciente (se actualiza cada 10 s).
- **Entradas y salidas**: mapa de espacios (verde disponible, rojo ocupado, naranja reservado), cobro automático por fracción, gracia y tope diario, recibo imprimible.
- **Abonados**: mensualidades por sede, renovación, alertas de vencimiento y aviso por correo (Brevo).
- **Tarifas flexibles**: cobro por minuto, por fracción o por hora, con gracia y tope diario; el recibo explica el cálculo.
- **Plano del parqueadero**: el administrador sube una foto o un boceto (cada puesto dibujado como un cuadro) y el plano se arma solo: el lector de imágenes corre en el navegador, sin IA ni Internet, reconoce puestos de carro y moto, zonas, vías y entrada, y endereza la foto. También puede describirlo con sus palabras, o usar IA opcional para fotos reales. Se guarda con un toque; ajustar a mano es opcional. La operación lo muestra en vivo, también en 3D.
- **Guías paso a paso**: recorrido guiado la primera vez (web) y guía rápida (app), siempre disponibles desde el botón de ayuda y desde "Más".
- **Capacidad ajustable** por sede y tipo de vehículo (crea o retira espacios sin tocar los ocupados).
- **Reportes**: recaudo, horas pico, cierre de caja por operador, comparativo de sedes e **indicadores del Marco Lógico**, exportables a **PDF y Excel**.
- **Avisos**: vencimiento de mensualidades por correo (automático cada mañana) y por WhatsApp; recibo digital por WhatsApp.
- **Historial** con búsqueda, filtros y anulación auditada.
- **Auditoría** en lenguaje claro ("Registró la salida de ABC123 y cobró $14.100"), con resumen de acciones sensibles.
- **Ley 1581 de 2012**: autorización de tratamiento de datos.
- **Respaldos automáticos** semanales de la base de datos con GitHub Actions (gratis).
- **Optimizado para crecer**: probado con 340.000 movimientos; las pantallas en vivo responden en ~30 ms.
- Modo claro/oscuro y diseño adaptable a celular (las tablas se vuelven tarjetas en pantallas pequeñas).

## Estructura

```
SIGPARK_WEB/
├── public/                 ← raíz web (lo único expuesto)
│   ├── index.html          ← inicio de sesión
│   ├── app.html            ← panel
│   ├── api/index.php       ← entrada de la API (/api/*)
│   └── assets/             ← css, js (vistas por módulo), librerías
├── backend/
│   ├── bootstrap.php
│   ├── lib/                ← Db, Auth (JWT/roles/sedes), Parking (cobro), Audit, Migrator…
│   ├── controllers/        ← rutas de la API por módulo
│   └── database/           ← schema.sql (se aplica solo) y demo.php
├── docs/DESPLIEGUE.md      ← hosting gratis: GitHub + Render + Aiven + UptimeRobot + respaldos
├── .github/workflows/      ← respaldo semanal automático de la base de datos
├── docs/API.md             ← referencia de la API (para la app Android)
├── Dockerfile, render.yaml ← despliegue en Render
└── iniciar-local.bat       ← servidor local con XAMPP
```

## Ejecutar en local (XAMPP)

1. Encienda MySQL y cree la base vacía: `CREATE DATABASE sigpar CHARACTER SET utf8mb4;`
2. Copie `.env.example` como `.env` y ponga su usuario/clave de MySQL (`DB_USER`, `DB_PASS`, `DB_PORT`).
3. Doble clic en **`iniciar-local.bat`** → se abre <http://localhost:8080>.

**Alternativa con Apache de XAMPP:** copie la carpeta `SIGPARK_WEB` dentro de `C:\xampp\htdocs` y abra
<http://localhost/SIGPARK_WEB/> (lleva directo a la aplicación). Solo `public/` es accesible desde el navegador:
`backend/`, `docs/` y el `.env` quedan bloqueados.

Las tablas se crean solas. Con `DEMO_DATA=true` se cargan 2 sedes y datos de ejemplo.
Cuentas demo (clave `Sigpar2026*`): `admin@sigpar.co` (superadmin), `gerente@sigpar.co` (admin),
`operador1@sigpar.co` (Sede Centro), `operador2@sigpar.co` (Sede Norte).

## Publicar gratis

Ver **[docs/DESPLIEGUE.md](docs/DESPLIEGUE.md)**.
