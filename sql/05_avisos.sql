-- =====================================================================
-- sql/05_avisos.sql
-- Parque Ambiental Municipal — avisos de un llamado nuevo.
--
-- Pegar en el SQL Editor de Supabase DESPUÉS de 01_esquema.sql.
-- Es aditiva e idempotente: se puede correr más de una vez sin romper nada.
--
-- Dos destinos posibles para el mismo aviso:
--   * push del navegador, que se prende y se apaga por dispositivo
--     (suscripciones_push);
--   * Telegram, que va a un único grupo y por eso se prende y se apaga para
--     todo el sistema (ajustes).
-- =====================================================================

-- ---------------------------------------------------------------------
-- suscripciones_push
--
-- Una fila por navegador que aceptó recibir avisos. El endpoint lo emite el
-- servicio de push del navegador (FCM, Mozilla, Apple) y es único: si la
-- misma persona entra desde el celular y desde la compu, son dos filas.
--
-- 'activa' es el interruptor de la pantalla de Avisos: apagarlo deja de
-- mandar sin tener que pedir el permiso del navegador de nuevo.
-- ---------------------------------------------------------------------
create table if not exists suscripciones_push (
  id           bigserial primary key,
  usuario_id   int not null references usuarios (id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  dispositivo  text,
  activa       boolean not null default true,
  creada_en    timestamptz not null default now(),
  usada_en     timestamptz
);

create index if not exists idx_suscripciones_usuario
  on suscripciones_push (usuario_id);

create index if not exists idx_suscripciones_activa
  on suscripciones_push (activa);

-- ---------------------------------------------------------------------
-- ajustes
--
-- Clave/valor para lo poco que se configura desde la pantalla y no desde una
-- variable de entorno. Hoy: si el sistema manda o no a Telegram.
-- ---------------------------------------------------------------------
create table if not exists ajustes (
  clave           text primary key,
  valor           text not null,
  actualizado_en  timestamptz not null default now(),
  actualizado_por text
);

insert into ajustes (clave, valor)
values ('telegram_activo', 'si')
on conflict (clave) do nothing;
