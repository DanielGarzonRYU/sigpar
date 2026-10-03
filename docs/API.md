# API REST de SIGPAR

Base: `https://SU-SERVICIO.onrender.com/api` (local: `http://localhost:8080/api`).
Formato JSON. Todas las rutas (excepto `/health` y `/auth/login`) requieren el encabezado:

```
Authorization: Bearer <token>
```

Esta es **la misma API que usará la app Android**: web y app comparten backend y base de datos,
por eso un cambio en una se ve en la otra.

Respuesta de error: `{"ok": false, "error": "mensaje"}` con código 401 (sesión), 403 (permiso), 404, 409 (conflicto), 422 (datos).

## Autenticación
| Método | Ruta | Cuerpo / notas |
|---|---|---|
| GET | `/health` | Estado del servidor y la BD (UptimeRobot) |
| POST | `/auth/login` | `{email, password, origen:"app"}` → `{token, usuario, sedes, empresa}` |
| GET | `/auth/me` | Usuario y sedes permitidas |
| POST | `/auth/password` | `{actual, nueva}` |
| PUT | `/auth/perfil` | `{nombre, foto?}`: cada usuario cambia su nombre y su foto (`"data:image/jpeg;base64,..."`, cuadrada; `null` la quita; sin la clave `foto` no cambia). Devuelve la sesión actualizada. `usuario.foto` llega en `/auth/login` y `/auth/me` |

## Operación (lo esencial para la app del operador)
| Método | Ruta | Cuerpo / notas |
|---|---|---|
| GET | `/operacion/estado?sede_id=` | **Recomendado para la app:** mapa + vehículos dentro en una sola petición (consultar cada 5 s) |
| GET | `/espacios?sede_id=` | Mapa: estado de cada espacio + placa/hora si está ocupado |
| PATCH | `/espacios/{id}/estado` | `{estado: disponible\|reservado\|inactivo, nota}` |
| POST | `/movimientos/entrada` | `{sede_id, placa, tipo_vehiculo, espacio_id?, propietario?, telefono?, autoriza_datos, origen:"app"}` → `{id, espacio, abonado}` |
| GET | `/movimientos/buscar-placa?placa=&sede_id=` | Vehículo dentro + `cotizacion {minutos, valor, detalle, es_abonado}` |
| GET | `/movimientos/{id}/cotizar` | Valor a cobrar en este momento |
| POST | `/movimientos/{id}/salida` | `{metodo_pago: efectivo\|tarjeta\|transferencia\|app}` → `{cobro, movimiento}` |
| GET | `/movimientos/activos?sede_id=` | Vehículos dentro con valor acumulado |
| GET | `/movimientos?sede_id=&placa=&estado=&tipo=&desde=&hasta=&page=&limit=` | Historial. Un movimiento entra en el rango si **entró o salió** en esas fechas, y se ordena por lo último que pasó (la salida de hoy de un vehículo que entró hace días queda arriba). `placa` busca por inicio (ABC → ABC123). `limit` máx. 5000 |
| GET | `/cambios?sede_id=` | `{version}`: cambia cada vez que alguien registra algo en la sede (entrada, salida, pago, anulación). La web la consulta cada 4 s y refresca la pantalla abierta solo si cambió |
| GET | `/movimientos/{id}` | Detalle + datos para el recibo |
| POST | `/movimientos/{id}/anular` | Admin. `{motivo}` |

### Plano del parqueadero
| Método | Ruta | Cuerpo / notas |
|---|---|---|
| GET | `/sedes/{id}/plano` | `{plano: {ancho, alto, elementos:[{t, x, y, w, h, texto?}]} \| null, plano_at, espacios:[{id, codigo, tipo_vehiculo, estado, plano_x, plano_y, plano_rot}]}` |
| PUT | `/sedes/{id}/plano` | Admin. `{ancho, alto, elementos, espacios:[{id, x, y, rot}], nuevos:[{tipo, x, y, rot}]}`. Rechaza espacios fuera del lote o encimados; los `nuevos` reciben código automático (C-25, M-09...) |
| DELETE | `/sedes/{id}/plano` | Admin. Quita el dibujo y la foto de calco; los espacios quedan sin ubicar |
| POST | `/sedes/{id}/plano/interpretar` | Admin. `{imagen?: "data:image/jpeg;base64,...", texto?}` → `{propuesta: {ancho, alto, elementos, espacios:[{tipo, x, y, rot}], notas}}`. Lee una foto o boceto con IA y propone el plano (no guarda nada). Requiere `ANTHROPIC_API_KEY`; sin ella responde 501 |

`GET /sedes/{id}/plano?fondo=1` (solo el editor) agrega `fondo: {img, x, y, w, h, op} | null` (la foto de calco) e `ia: bool`.
`PUT` acepta `fondo` con ese mismo formato (o `null` para quitarla); si no se envía, la foto no cambia.
El asistente por descripción ("lote de 30 x 45 m con 40 carros...") corre en el navegador y no usa la API.

Medidas en celdas de 1,25 m. Huella de cada espacio (ancho x largo): carro 2 x 4, moto y bicicleta 1 x 2; `rot = 1` lo acuesta.
Tipos de elemento `t`: `via`, `entrada`, `salida`, `zona` (sin parqueo), `muro`, `columna`, `caseta` (caja), `texto`.
`/operacion/estado` incluye `planos: {sede_id: plano_at}`: el cliente descarga el dibujo solo cuando esa fecha cambia.

`tipo_vehiculo`: `carro`, `moto`, `bicicleta`. La placa se normaliza (`abc-123` → `ABC123`).
Si la placa pertenece a un abonado vigente de esa sede, la salida vale $0.

## Abonados
| Método | Ruta | Cuerpo / notas |
|---|---|---|
| GET | `/abonados?sede_id=&q=&estado=` | estado: vigente, por_vencer, vencido, inactivo |
| GET | `/abonados/alertas?sede_id=` | Por vencer / vencidos recientes |
| GET | `/abonados/{id}` | Detalle + pagos |
| POST | `/abonados` | `{sede_id, nombre, placa, tipo_vehiculo, documento?, telefono?, email?, fecha_inicio?, meses, valor?, metodo_pago, autoriza_datos:true}` |
| PUT | `/abonados/{id}` | Admin. Datos del abonado |
| POST | `/abonados/{id}/renovar` | `{meses, metodo_pago, valor?}` — `valor` distinto a la tarifa solo lo puede enviar un administrador |
| PATCH | `/abonados/{id}/estado` | Admin. `{activo}` |
| POST | `/abonados/notificar` | Admin. Correos vía Brevo |

## Reportes y administración
| Método | Ruta | Rol |
|---|---|---|
| GET | `/dashboard?sede_id=` | Todos |
| GET | `/reportes/caja?fecha=&sede_id=` | Todos |
| GET | `/reportes/recaudo?desde=&hasta=&sede_id=` | Admin |
| GET | `/reportes/horas-pico?desde=&hasta=&sede_id=` | Admin |
| GET | `/reportes/comparativo?desde=&hasta=` | Admin |
| GET | `/reportes/indicadores?desde=&hasta=&sede_id=` — indicadores SMART del Marco Lógico | Admin |
| GET/POST/PUT | `/sedes`, `/sedes/{id}`, PATCH `/sedes/{id}/estado` | Superadmin (GET: todos) |
| GET/POST/PUT | `/usuarios`, `/usuarios/{id}`, PATCH `/usuarios/{id}/estado` | Admin |
| DELETE | `/usuarios/{id}`: elimina la cuenta; sus movimientos y cobros pasados se conservan ("Usuario eliminado"). No permite eliminarse a sí mismo ni al último superadministrador activo | Admin (solo operadores de sus sedes) |
| GET/POST/PUT/DELETE | `/espacios`, `/espacios/lote`, `/espacios/{id}` | Admin |
| PUT | `/espacios/capacidad` `{sede_id, tipo_vehiculo, cantidad}` — crea o retira espacios hasta esa capacidad (nunca toca ocupados/reservados) | Admin |
| GET / PUT | `/tarifas?sede_id=`, `/tarifas/{sede_id}` `{tarifas:[{tipo_vehiculo, modo_cobro, valor_fraccion, fraccion_minutos, minutos_gracia, tope_dia, valor_mensualidad}]}` | Admin (GET: todos) |
| GET | `/auditoria?desde=&hasta=&sede_id=&categoria=` (categoria: sensibles, operacion, abonados, configuracion, accesos) → `{registros, resumen}` | Admin |
| GET / PUT | `/config` | Superadmin (GET: todos) |

### Modos de cobro (`modo_cobro`)
| Modo | `valor_fraccion` significa | Ejemplo de `detalle` en el recibo |
|---|---|---|
| `minuto` | precio de cada minuto | `37 min × $50 = $1.850` |
| `fraccion` | precio de cada bloque de `fraccion_minutos` | `3 fracciones de 15 min × $1.000 = $3.000` |
| `hora` | precio de cada hora o fracción de hora | `2 horas × $4.000 = $8.000` |

Además: `minutos_gracia` (no se cobra), `tope_dia` (máximo por cada 24 h; 0 = sin tope) y el redondeo global de **Configuración**.
El detalle del cálculo se guarda en `movimientos.detalle_cobro`.

Los reportes con `desde`/`hasta` aceptan un periodo de máximo 1 año.

Sin `sede_id`, las consultas devuelven todas las sedes a las que el usuario tiene acceso.
