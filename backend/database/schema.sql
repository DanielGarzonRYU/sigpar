-- =====================================================================
-- SIGPAR - Sistema de Gestión de Parqueaderos
-- Esquema de base de datos (MySQL 8 / MariaDB 10.4+)
-- Compartido por la plataforma web y la aplicación Android.
-- Todas las tablas tienen llave primaria (requisito de Aiven MySQL).
-- El backend ejecuta este archivo al arrancar: es idempotente.
-- =====================================================================

CREATE TABLE IF NOT EXISTS sedes (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(100) NOT NULL,
  direccion     VARCHAR(200) NULL,
  telefono      VARCHAR(30)  NULL,
  activa        TINYINT(1)   NOT NULL DEFAULT 1,
  -- Plano dibujado por el administrador: tamaño del lote y elementos (vías, entrada, salida, columnas...) en JSON
  plano         MEDIUMTEXT   NULL,
  plano_at      DATETIME     NULL,
  -- Foto o boceto que el administrador usa como calco al dibujar (solo lo descarga el editor)
  plano_fondo   MEDIUMTEXT   NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sedes_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS usuarios (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre         VARCHAR(100) NOT NULL,
  email          VARCHAR(150) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  rol            ENUM('superadmin','admin','operador') NOT NULL DEFAULT 'operador',
  activo         TINYINT(1)   NOT NULL DEFAULT 1,
  ultimo_acceso  DATETIME     NULL,
  -- Foto de perfil: imagen cuadrada pequeña (JPG de 256 px) guardada como texto
  foto           MEDIUMTEXT   NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuarios_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sedes a las que tiene acceso cada admin/operador (el superadmin ve todas).
CREATE TABLE IF NOT EXISTS usuario_sede (
  usuario_id  INT UNSIGNED NOT NULL,
  sede_id     INT UNSIGNED NOT NULL,
  PRIMARY KEY (usuario_id, sede_id),
  CONSTRAINT fk_us_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_us_sede    FOREIGN KEY (sede_id)    REFERENCES sedes(id)    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS espacios (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sede_id        INT UNSIGNED NOT NULL,
  codigo         VARCHAR(20)  NOT NULL,
  tipo_vehiculo  ENUM('carro','moto','bicicleta') NOT NULL DEFAULT 'carro',
  estado         ENUM('disponible','ocupado','reservado','inactivo') NOT NULL DEFAULT 'disponible',
  nota           VARCHAR(200) NULL,
  -- Ubicación en el plano (celdas de la cuadrícula); NULL = sin ubicar. plano_rot 1 = acostado (horizontal).
  plano_x        SMALLINT     NULL,
  plano_y        SMALLINT     NULL,
  plano_rot      TINYINT      NOT NULL DEFAULT 0,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_espacio_sede_codigo (sede_id, codigo),
  KEY ix_espacios_estado (sede_id, estado),
  CONSTRAINT fk_espacios_sede FOREIGN KEY (sede_id) REFERENCES sedes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Una tarifa por sede y tipo de vehículo.
-- modo_cobro:
--   'minuto'   → valor_fraccion es el precio de cada minuto (ej. $50/min)
--   'fraccion' → valor_fraccion es el precio de cada bloque de fraccion_minutos (ej. $1.000 cada 15 min)
--   'hora'     → valor_fraccion es el precio de cada hora o fracción de hora
-- valor_hora se conserva como equivalente informativo por hora.
CREATE TABLE IF NOT EXISTS tarifas (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sede_id            INT UNSIGNED NOT NULL,
  tipo_vehiculo      ENUM('carro','moto','bicicleta') NOT NULL,
  modo_cobro         ENUM('minuto','fraccion','hora') NOT NULL DEFAULT 'fraccion',
  valor_fraccion     DECIMAL(10,2) NOT NULL DEFAULT 0,
  valor_hora         DECIMAL(10,2) NOT NULL DEFAULT 0,
  fraccion_minutos   SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  minutos_gracia     SMALLINT UNSIGNED NOT NULL DEFAULT 5,
  tope_dia           DECIMAL(10,2) NOT NULL DEFAULT 0,
  valor_mensualidad  DECIMAL(10,2) NOT NULL DEFAULT 0,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tarifa_sede_tipo (sede_id, tipo_vehiculo),
  CONSTRAINT fk_tarifas_sede FOREIGN KEY (sede_id) REFERENCES sedes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Clientes con mensualidad. Válidos solo en su sede.
CREATE TABLE IF NOT EXISTS abonados (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sede_id         INT UNSIGNED NOT NULL,
  nombre          VARCHAR(120) NOT NULL,
  documento       VARCHAR(30)  NULL,
  telefono        VARCHAR(30)  NULL,
  email           VARCHAR(150) NULL,
  placa           VARCHAR(10)  NOT NULL,
  tipo_vehiculo   ENUM('carro','moto','bicicleta') NOT NULL DEFAULT 'carro',
  fecha_inicio    DATE NOT NULL,
  fecha_fin       DATE NOT NULL,
  autoriza_datos  TINYINT(1) NOT NULL DEFAULT 0,
  activo          TINYINT(1) NOT NULL DEFAULT 1,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_abonado_sede_placa (sede_id, placa),
  KEY ix_abonados_fin (fecha_fin),
  CONSTRAINT fk_abonados_sede FOREIGN KEY (sede_id) REFERENCES sedes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cada pago/renovación de mensualidad (cuenta como ingreso).
CREATE TABLE IF NOT EXISTS abonado_pagos (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  abonado_id    INT UNSIGNED NOT NULL,
  sede_id       INT UNSIGNED NOT NULL,
  periodo_inicio DATE NOT NULL,
  periodo_fin    DATE NOT NULL,
  valor         DECIMAL(10,2) NOT NULL,
  metodo_pago   ENUM('efectivo','tarjeta','transferencia','app') NOT NULL DEFAULT 'efectivo',
  usuario_id    INT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_pagos_fecha (sede_id, created_at),
  CONSTRAINT fk_pagos_abonado FOREIGN KEY (abonado_id) REFERENCES abonados(id) ON DELETE CASCADE,
  CONSTRAINT fk_pagos_sede    FOREIGN KEY (sede_id)    REFERENCES sedes(id),
  CONSTRAINT fk_pagos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Entradas y salidas de vehículos (corazón del sistema).
CREATE TABLE IF NOT EXISTS movimientos (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sede_id             INT UNSIGNED NOT NULL,
  espacio_id          INT UNSIGNED NULL,
  placa               VARCHAR(10)  NOT NULL,
  tipo_vehiculo       ENUM('carro','moto','bicicleta') NOT NULL DEFAULT 'carro',
  propietario         VARCHAR(120) NULL,
  telefono            VARCHAR(30)  NULL,
  abonado_id          INT UNSIGNED NULL,
  entrada_at          DATETIME NOT NULL,
  salida_at           DATETIME NULL,
  minutos             INT UNSIGNED NULL,
  valor               DECIMAL(10,2) NULL,
  detalle_cobro       VARCHAR(255) NULL,
  metodo_pago        ENUM('efectivo','tarjeta','transferencia','app','abonado') NULL,
  estado              ENUM('activo','finalizado','anulado') NOT NULL DEFAULT 'activo',
  origen              ENUM('web','app') NOT NULL DEFAULT 'web',
  observacion         VARCHAR(255) NULL,
  usuario_entrada_id  INT UNSIGNED NULL,
  usuario_salida_id   INT UNSIGNED NULL,
  -- Índices pensados para las consultas que se repiten cada pocos segundos:
  KEY ix_mov_placa (placa, estado),                        -- ¿este vehículo ya está dentro?
  KEY ix_mov_estado_sede (estado, sede_id),               -- vehículos dentro de una sede (pocos 'activo')
  KEY ix_mov_espacio_estado (espacio_id, estado),          -- quién ocupa cada espacio (mapa)
  KEY ix_mov_sede_entrada (sede_id, entrada_at),           -- entradas por sede y fecha
  KEY ix_mov_sede_salida (sede_id, salida_at),             -- recaudo por sede y fecha
  KEY ix_mov_entrada (entrada_at),                         -- historial ordenado por fecha
  CONSTRAINT fk_mov_sede     FOREIGN KEY (sede_id)    REFERENCES sedes(id),
  CONSTRAINT fk_mov_espacio  FOREIGN KEY (espacio_id) REFERENCES espacios(id) ON DELETE SET NULL,
  CONSTRAINT fk_mov_abonado  FOREIGN KEY (abonado_id) REFERENCES abonados(id) ON DELETE SET NULL,
  CONSTRAINT fk_mov_u_ent    FOREIGN KEY (usuario_entrada_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  CONSTRAINT fk_mov_u_sal    FOREIGN KEY (usuario_salida_id)  REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Registro de auditoría: quién hizo qué, cuándo y dónde.
CREATE TABLE IF NOT EXISTS auditoria (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id  INT UNSIGNED NULL,
  sede_id     INT UNSIGNED NULL,
  accion      VARCHAR(40)  NOT NULL,
  entidad     VARCHAR(40)  NOT NULL,
  entidad_id  INT UNSIGNED NULL,
  detalle     TEXT NULL,
  ip          VARCHAR(45) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_aud_fecha (created_at),
  KEY ix_aud_sede (sede_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Parámetros generales del sistema (clave/valor).
CREATE TABLE IF NOT EXISTS configuracion (
  clave  VARCHAR(60)  NOT NULL PRIMARY KEY,
  valor  VARCHAR(500) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO configuracion (clave, valor) VALUES
  ('empresa_nombre', 'SIGPAR Parqueaderos'),
  ('empresa_nit', ''),
  ('dias_alerta_abonados', '5'),
  ('redondeo_cobro', '50'),
  ('avisos_automaticos', '1'),
  ('avisos_ultimo_envio', ''),
  ('politica_datos', 'Sus datos personales serán tratados conforme a la Ley 1581 de 2012 únicamente para la prestación del servicio de parqueadero.');
