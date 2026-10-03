# Guía de despliegue gratuito de SIGPAR

Costo: **$0**. Se usan los mismos principios que en el proyecto KAF: GitHub + Render, con claves en variables de entorno y base de datos que se prepara sola.

```
GitHub (git push) ──► Render: 1 contenedor Docker (plan free)
                         ├─ /        → Web (panel administrador/operador)
                         └─ /api/*   → API REST PHP + JWT ──► Aiven MySQL (plan free)
App Android ─────────────────┘                ▲
UptimeRobot ── ping cada 5 min a /api/health ─┘   (evita que Render se duerma)
Brevo ── correos de vencimiento de abonados (opcional)
```

| Pieza | Servicio gratis | Para qué |
|---|---|---|
| Código | GitHub (repo privado) | Render publica solo en cada `git push` |
| Web + API | Render (Docker, plan Free) | Un único servicio: web y API juntas |
| Base de datos | Aiven for MySQL (plan Free) | MySQL 8 real, compartido por web y app |
| Mantener despierto | UptimeRobot (Free) | Ping cada 5 minutos |
| Correos | Brevo (Free, 300/día) | Avisos a abonados por vencer |
| Copias de seguridad | GitHub Actions (Free) | Respaldo semanal automático de la base (90 días) |

---

## 1. Base de datos en Aiven (MySQL gratis)

1. Cree una cuenta en <https://aiven.io> → **Create service** → **MySQL** → plan **Free**.
   **Importante (rendimiento):** elija la región/nube más cercana a la de Render (por ejemplo, ambas en EE. UU.).
   Cada pantalla hace varias consultas; si el servidor y la base están en continentes distintos, todo se vuelve lento.
2. Cuando el servicio esté en *Running*, en **Overview → Connection information** copie:
   `Host`, `Port`, `User` (avnadmin), `Password` y `Database name` (defaultdb).
3. Descargue el **CA certificate** (`ca.pem`). Abra el archivo con el Bloc de notas y copie **todo** su contenido (incluyendo `-----BEGIN CERTIFICATE-----`).

> No hay que crear tablas a mano: SIGPAR las crea automáticamente la primera vez que arranca.

## 2. Subir el código a GitHub

```bash
cd SIGPARK_WEB
git init
git add .
git commit -m "SIGPAR web inicial"
git branch -M main
git remote add origin https://github.com/SU_USUARIO/sigpar.git
git push -u origin main
```

El `.gitignore` ya excluye `.env`, los certificados y la carpeta `documentos/`.

## 3. Servicio en Render

1. En <https://render.com> → **New → Blueprint** → elija el repositorio. Render lee `render.yaml`
   y crea el servicio **sigpar** (Docker, plan Free).
   *(Alternativa: New → Web Service → repositorio → Runtime: Docker → Plan: Free.)*
2. En **Environment** complete las variables:

| Variable | Valor |
|---|---|
| `DB_HOST` | Host de Aiven |
| `DB_PORT` | Puerto de Aiven |
| `DB_NAME` | `defaultdb` |
| `DB_USER` | `avnadmin` |
| `DB_PASS` | Contraseña de Aiven |
| `DB_SSL_CA` | Contenido completo de `ca.pem` |
| `JWT_SECRET` | Render lo genera solo (o una cadena aleatoria de 32+ caracteres). La clave de ejemplo de `.env.example` se rechaza fuera del equipo local |
| `ADMIN_EMAIL` | Correo del superadministrador |
| `ADMIN_PASSWORD` | Clave inicial (cámbiela al entrar). **Obligatoria:** si se omite y `DEMO_DATA=false`, se genera una clave aleatoria que solo aparece en los *Logs* de Render |
| `DEMO_DATA` | `true` solo para la sustentación/demostración; `false` en real |
| `BREVO_API_KEY`, `MAIL_FROM` | Opcional (correos de vencimiento, manuales y automáticos) |
| `ANTHROPIC_API_KEY` | Opcional. Activa "Leer con IA" en el editor del plano (propone el plano a partir de una foto o boceto). Cada lectura consume créditos de Anthropic. Sin ella el asistente por descripción y el calco funcionan igual |
| `ADMIN_RESET` | Solo si el superadministrador olvidó su clave: póngala en `true`, reinicie (la clave vuelve a `ADMIN_PASSWORD`) y **luego bórrela** |

3. **Deploy**. Al terminar, abra `https://sigpar.onrender.com` (o el nombre que asigne Render).
4. Verifique `https://sigpar.onrender.com/api/health` → debe responder `{"ok":true,...}`.

## 4. Evitar que Render se duerma (UptimeRobot)

El plan gratis de Render apaga el servicio tras ~15 min sin tráfico y la primera petición tarda ~50 s.

1. Cree cuenta en <https://uptimerobot.com> → **Add New Monitor**.
2. Tipo **HTTP(s)**, URL `https://SU-SERVICIO.onrender.com/api/health`, intervalo **5 minutes**.

`/api/health` también hace una consulta a MySQL, así que mantiene despiertos **el servidor y la base de datos**.

**Por qué alcanza:** Render da 750 horas gratis al mes; un servicio encendido 24/7 usa ~720–744. Por eso web y API van en **un solo** contenedor.

**Si aun así el servidor tarda:** la web muestra "Conectando con el servidor…" y reintenta sola las consultas durante ~90 s.
Las operaciones que guardan datos (entradas, salidas, renovaciones) se reintentan solo si el servidor confirma que no las procesó;
si la conexión se corta a mitad de camino, se avisa al operador para que revise el historial antes de repetir (así nunca se cobra dos veces).

## 5. Correos con Brevo (opcional)

1. Cuenta en <https://www.brevo.com> → **SMTP & API → API Keys → Generate**.
2. Verifique un remitente (Senders) y úselo en `MAIL_FROM`.
3. Cargue `BREVO_API_KEY` en Render.

- **Automático:** cada mañana (desde las 7 a. m.) el sistema envía solo el recordatorio a los abonados que vencen en N días
  y el día anterior. Lo dispara el mismo ping de UptimeRobot, así que no necesita ningún servicio extra. Se puede apagar en **Configuración**.
- **Manual:** en **Abonados → Avisar por correo**.
- **WhatsApp (gratis, sin API):** en las alertas de vencimiento y en cada recibo hay un botón que abre WhatsApp con el mensaje ya escrito.

Se usa la API HTTPS de Brevo (puerto 443) porque Render bloquea el SMTP (puertos 465/587), igual que pasó en KAF.

## 6. Respaldos automáticos de la base de datos (GitHub Actions, gratis)

El archivo `.github/workflows/respaldo.yml` exporta la base cada domingo y guarda el archivo `.sql.gz` durante 90 días.

1. En GitHub: **Settings → Secrets and variables → Actions → New repository secret** y cree:
   `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS` y `DB_SSL_CA` (los mismos valores de Render).
2. Pruébelo: **Actions → Respaldo de la base de datos → Run workflow**. Al terminar, descargue el archivo en *Artifacts*.
3. Para restaurar: `gunzip -c sigpar-AAAA-MM-DD.sql.gz | mysql -h HOST -P PUERTO -u USUARIO -p --ssl-ca=ca.pem defaultdb`

## 7. App Android apuntando al servidor publicado

La versión *release* de la app ya apunta a `https://sigpar.onrender.com` (archivo `app-android/app/build.gradle.kts`).
Si Render le asigna otro nombre, cámbielo ahí. Igual, en la pantalla de inicio de sesión se puede tocar "Servidor" y escribir otra dirección.

1. Cree la llave de firma una sola vez (guárdela bien: sin ella no se pueden publicar actualizaciones):
   `keytool -genkey -v -keystore sigpar-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias sigpar` dentro de `app-android/`.
2. Genere el APK con la clave de esa llave en la variable `SIGPAR_KS_PASS`: `set SIGPAR_KS_PASS=su-clave` y luego `gradlew assembleRelease` → `app-android/app/build/outputs/apk/release/app-release.apk`.
3. Repártalo por un enlace (Drive) para instalarlo en los celulares de los operadores, o publíquelo en Google Play (pago único de 25 USD).

## 8. Rendimiento y límites del plan gratis (ya configurado y medido)

Se probó con **340.000 movimientos** (varios años de operación). Tiempos medidos por petición:

| Pantalla / consulta | Frecuencia | Tiempo |
|---|---|---|
| ¿Hubo cambios? (`/api/cambios`, una consulta por sede usando un índice) | cada 4 s por pestaña abierta | ~5 ms |
| Entradas y salidas (mapa + vehículos dentro, 1 sola petición) | al haber un cambio y cada 30 s | ~30 ms |
| Dashboard de todas las sedes | al haber un cambio y cada 60 s | ~30 ms |
| Historial (página) / búsqueda por placa | al usarlo | ~170 ms / ~30 ms |
| Reportes de hasta 1 año | al usarlo | 60–140 ms |

| Riesgo | Qué se hizo |
|---|---|
| Consultas más lentas a medida que crece el historial | Índices específicos para el mapa, los vehículos dentro, el historial y los reportes |
| Render gratis tiene 512 MB de RAM | Apache limitado a 12 procesos (no se queda sin memoria) |
| Render gratis tiene 0,1 CPU | Las pantallas solo piden datos completos cuando hubo un cambio (aviso liviano cada 4 s) y solo redibujan si algo cambió |
| Fotos del plano y de perfil | Se reducen en el navegador antes de subirlas (JPG de 1568 px y 256 px) y se guardan en la base: el disco de Render se borra en cada despliegue y no se pierden |
| Peticiones acumuladas si la red está lenta | Nunca se lanza una actualización si la anterior no terminó |
| Conectar a Aiven con SSL cuesta 100–300 ms | Conexiones persistentes: se reutilizan entre peticiones |
| PHP recompilando en cada petición | OPcache activado |
| Reportes enormes por error (ej. 20 años) | Los reportes admiten máximo 1 año por consulta |
| Exportaciones incompletas | Hasta 5.000 filas; si hay más, se avisa para acotar las fechas |
| Usuarios con la versión vieja tras publicar | HTML/JS/CSS se revalidan en cada visita; librerías en caché 30 días |
| Muchas pestañas consultando en vivo | La web deja de consultar cuando la pestaña no está visible |
| Operadores en el mismo WiFi bloqueados por claves erradas | El bloqueo es por correo (8 intentos), no por la IP compartida |

Capacidad estimada en el plan gratis: varias sedes con varios operadores y administradores conectados a la vez.
Si el negocio crece mucho (decenas de pantallas en vivo), pase al plan B o a un plan pago de Render; el código no cambia.

## 8. Dominio propio (opcional)

Render da gratis una dirección `https://su-servicio.onrender.com`. Si compra un dominio (≈ $40.000–70.000 COP/año, como estima
el estudio de factibilidad), en Render → **Settings → Custom Domains** se conecta sin costo adicional y con HTTPS incluido.

## 9. Plan B sin "dormirse": Oracle Cloud Always Free

Si el parqueadero entra en operación real y se quiere cero riesgo de arranque en frío:
una VM *Always Free* de Oracle Cloud (pide tarjeta solo para verificar, no cobra) corre Docker 24/7.
Como SIGPAR ya está en Docker, basta con instalar Docker en la VM y ejecutar:

```bash
docker build -t sigpar .
docker run -d --restart always -p 80:10000 --env-file .env sigpar
```

Nota: en `--env-file` cada variable ocupa una sola línea. Para `DB_SSL_CA` use la **ruta** al archivo (`DB_SSL_CA=/ruta/ca.pem`,
montándolo con `-v /ruta/ca.pem:/ruta/ca.pem`) o el certificado en una línea con `
` en lugar de los saltos de línea.

## 10. Datos personales (Ley 1581 de 2012)

- HTTPS en todo (Render lo incluye gratis).
- Contraseñas cifradas (bcrypt) y sesión con JWT.
- Nombre/teléfono del cliente solo se guardan si el cliente autoriza (casilla en la entrada).
- Abonados: la autorización es obligatoria para inscribirlos.
- Edite la política de datos en **Configuración**; el operador puede mostrarla ("ver política") al pedir la autorización.
