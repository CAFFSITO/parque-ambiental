-- =====================================================================
-- sql/11_observabilidad.sql
-- Parque Ambiental Municipal — la consulta guardada del despliegue.
--
-- Pegar en el SQL Editor de Supabase DESPUÉS de 06_dispositivos.sql y
-- 08_credenciales_dispositivos.sql. Es aditiva e idempotente: se puede correr
-- más de una vez sin romper nada.
--
-- NO crea ni modifica ninguna tabla, ninguna columna y ninguna fila. Agrega
-- UNA vista de solo lectura.
--
-- PARA QUÉ EXISTE
--
-- Es la consulta que hay que mirar durante la ventana de observación del
-- despliegue (documents/contexto/99-deploy.md, pasos 7 y 9) y cada vez que
-- alguien pregunte "¿el nodo está vivo?". Responde de un vistazo:
--
--   * hace cuántos segundos reportó cada dispositivo, contra el mismo umbral
--     de 90 s que usan la vigilancia, el tablero y la pantalla de Dispositivos;
--   * si entró por credencial propia y cuándo la usó por última vez;
--   * cuántas lecturas escribió en la última hora, que es lo que delata un
--     nodo que responde pero dejó de medir.
--
-- Está como VISTA y no como consulta suelta en un documento por dos razones:
-- se puede correr igual desde el SQL Editor con `select * from ...`, y además
-- queda disponible por PostgREST para cualquier tablero externo, sin que nadie
-- tenga que volver a escribir el mismo `left join`.
--
-- SIN SECRETOS. La vista no toca `secreto_hash` ni `prefijo`: de las
-- credenciales solo saca el id, el estado y las fechas.
--
-- SI ESTA MIGRACIÓN NO SE APLICA, no se rompe nada: es puramente de
-- observabilidad y ningún camino del código la consulta. El equivalente sin
-- vista está transcripto en 99-deploy.md §7.2.
-- =====================================================================

drop view if exists dispositivos_ultimo_contacto;

-- ---------------------------------------------------------------------
-- Último contacto de cada dispositivo, con su estado derivado.
--
-- El corte de 90 segundos es ESTRICTAMENTE MAYOR, igual que
-- estaCaido() en lib/alertas.ts y estadoDeConexion() en lib/dispositivos.ts:
-- a los 90 exactos el nodo todavía está en línea, a los 91 ya no. Si alguna
-- vez se mueve SEGUNDOS_SIN_SENAL, hay que moverlo también acá — y hay un
-- test que lo fija en 90 (tests/vigilancia.test.ts).
-- ---------------------------------------------------------------------
create or replace view dispositivos_ultimo_contacto as
select
  d.id,
  d.codigo,
  d.naturaleza,
  d.activo,
  a.codigo as area,
  a.activa as area_activa,
  d.ultimo_contacto_en,

  -- Segundos desde el último contacto. null si nunca reportó.
  case
    when d.ultimo_contacto_en is null then null
    else greatest(0, floor(extract(epoch from (now() - d.ultimo_contacto_en)))::bigint)
  end as segundos_sin_reportar,

  case
    when d.ultimo_contacto_en is null then 'NUNCA_REPORTO'
    when extract(epoch from (now() - d.ultimo_contacto_en)) > 90 then 'SIN_SENAL'
    else 'EN_LINEA'
  end as conexion,

  -- Solo se vigilan los físicos y activos: un simulador que deja de simular no
  -- es una emergencia. Es la misma regla de revisarNodosCaidos().
  (d.naturaleza = 'FISICO' and d.activo) as vigilado,

  -- Cuántas lecturas escribió en la última hora. Un nodo que contesta pero
  -- dejó de medir se ve acá y en ningún otro lado.
  (
    select count(*)
      from lecturas l
     where l.dispositivo_id = d.id
       and l.tomada_en > now() - interval '1 hour'
  ) as lecturas_ultima_hora,

  -- Estado de sus credenciales. Sin hash y sin prefijo.
  (
    select count(*)
      from dispositivo_credenciales c
     where c.dispositivo_id = d.id
       and c.estado <> 'REVOCADA'
       and (c.expira_en is null or c.expira_en > now())
  ) as credenciales_vigentes,

  (
    select max(c.usada_en)
      from dispositivo_credenciales c
     where c.dispositivo_id = d.id
  ) as credencial_usada_en

from dispositivos d
left join areas a on a.id = d.area_id;

comment on view dispositivos_ultimo_contacto is
  'Observabilidad del despliegue: último contacto, estado de conexión contra el umbral de 90 s, lecturas de la última hora y vigencia de credenciales. Solo lectura, sin secretos.';
