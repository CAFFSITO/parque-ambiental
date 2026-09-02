-- =====================================================================
-- sql/01_esquema.sql
-- Parque Ambiental Municipal de Berisso — esquema de base de datos
-- Pegar PRIMERO en el SQL Editor de Supabase.
-- Sin RLS: el acceso es exclusivamente server-side con la service role key.
-- =====================================================================

drop table if exists llamados cascade;
drop table if exists lecturas cascade;
drop table if exists usuarios cascade;
drop table if exists empleados cascade;
drop table if exists areas cascade;

-- ---------------------------------------------------------------------
-- areas
-- ---------------------------------------------------------------------
create table areas (
  id         serial primary key,
  codigo     text not null unique,
  nombre     text not null,
  tipo       text not null,
  temp_min   numeric not null,
  temp_max   numeric not null,
  hum_min    numeric not null,
  hum_max    numeric not null,
  activa     boolean not null default true,
  creada_en  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- empleados
-- ---------------------------------------------------------------------
create table empleados (
  id                serial primary key,
  legajo            text not null unique,
  nombre            text not null,
  apellido          text not null,
  dni               text not null,
  fecha_nacimiento  date,
  telefono          text,
  email             text,
  domicilio         text,
  area_id           int references areas (id),
  tarea             text,
  turno             char(1),
  fecha_ingreso     date,
  estado            text not null default 'activo',
  observaciones     text,
  creado_en         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- usuarios
-- ---------------------------------------------------------------------
create table usuarios (
  id             serial primary key,
  usuario        text not null unique,
  password_hash  text not null,
  rol            text not null check (rol in ('ADMINISTRADOR', 'EMPLEADO')),
  empleado_id    int references empleados (id),
  area_id        int references areas (id),
  activo         boolean not null default true,
  creado_en      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- lecturas
-- ---------------------------------------------------------------------
create table lecturas (
  id           bigserial primary key,
  dispositivo  text,
  area_id      int references areas (id),
  temperatura  numeric,
  humedad      numeric,
  tomada_en    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- llamados
-- ---------------------------------------------------------------------
create table llamados (
  id            bigserial primary key,
  area_id       int references areas (id),
  tipo          text not null check (tipo in ('NORMAL', 'EMERGENCIA')),
  origen        text not null check (origen in ('SENSOR', 'EMPLEADO')),
  estado        text not null default 'NO_ATENDIDO' check (estado in ('NO_ATENDIDO', 'ATENDIDO')),
  motivo        text,
  detalle       text,
  creado_por    text,
  creado_en     timestamptz not null default now(),
  atendido_por  text,
  atendido_en   timestamptz
);

-- ---------------------------------------------------------------------
-- indices
-- ---------------------------------------------------------------------
create index idx_llamados_creado_en on llamados (creado_en desc);
create index idx_llamados_area      on llamados (area_id);
create index idx_llamados_estado    on llamados (estado);
create index idx_lecturas_area_hora on lecturas (area_id, tomada_en desc);
