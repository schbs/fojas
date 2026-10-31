-- Fojas G2: búsqueda por palabras (tsvector en español + GIN) para la recuperación híbrida, y registro de las preguntas
-- que el asistente no pudo responder con los documentos.

-- Texto indexado: la sección pesa más que el cuerpo (un título como "Cancelaciones" ya dice de qué trata el chunk).
alter table chunks add column fts tsvector generated always as (
  setweight(to_tsvector('spanish', coalesce(section, '')), 'A') || setweight(to_tsvector('spanish', contenido), 'B')
) stored;

create index chunks_fts_gin on chunks using gin (fts);

-- Top k por palabras clave. Las palabras de la pregunta se unen con OR (con AND, una pregunta natural casi nunca
-- coincide entera). Devuelve también la similitud coseno con la pregunta, para que el reranking compare todo igual.
create or replace function keyword_chunks(
  query_text text,
  query_embedding vector(768),
  k integer default 10,
  filtro_doc text default null
)
returns table (doc_slug text, titulo text, page integer, section text, contenido text, similarity double precision, rank real)
language sql stable
as $$
  with q as (
    select nullif(replace(plainto_tsquery('spanish', query_text)::text, '&', '|'), '')::tsquery as tsq
  )
  select c.doc_slug, d.titulo, c.page, c.section, c.contenido,
         1 - (c.embedding <=> query_embedding) as similarity,
         ts_rank_cd(c.fts, q.tsq) as rank
  from q, chunks c
  join documents d on d.slug = c.doc_slug
  where q.tsq is not null
    and c.fts @@ q.tsq
    and (filtro_doc is null or c.doc_slug = filtro_doc)
  order by rank desc
  limit least(k, 50);
$$;

-- Preguntas sin evidencia: el estudio las revisa para saber qué documentos faltan (panel de G3).
create table unanswered (
  id bigint generated always as identity primary key,
  pregunta text not null check (char_length(pregunta) between 1 and 1000),
  -- similitud coseno del mejor chunk encontrado (null si no hubo ninguno)
  mejor_similitud double precision,
  -- umbral: nada se parecía lo suficiente; modelo: el modelo dijo que no estaba; citas: las citas no sostenían la respuesta
  motivo text not null check (motivo in ('umbral', 'modelo', 'citas')),
  creado_en timestamptz not null default now()
);

create index unanswered_creado on unanswered (creado_en desc);

-- Solo el servidor (clave secreta): sin políticas públicas, y las funciones no se exponen a anon ni a authenticated.
alter table unanswered enable row level security;
revoke execute on function match_chunks(vector, integer, double precision, text) from anon, authenticated;
revoke execute on function keyword_chunks(text, vector, integer, text) from anon, authenticated;
