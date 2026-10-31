-- Fojas: documentos del estudio, chunks con embeddings (gemini-embedding-001, 768 dimensiones) y búsqueda por similitud.
create extension if not exists vector;

create table documents (
  slug text primary key,
  titulo text not null,
  hash_archivo text not null,
  paginas integer not null check (paginas > 0),
  ingestado_en timestamptz not null default now()
);

create table chunks (
  id bigint generated always as identity primary key,
  doc_slug text not null references documents (slug) on delete cascade,
  page integer not null check (page > 0),
  section text not null default '',
  contenido text not null,
  -- sha256 del contenido normalizado: el mismo texto se guarda una sola vez (reingesta idempotente).
  hash text not null unique,
  embedding vector(768) not null,
  creado_en timestamptz not null default now()
);

create index chunks_doc_page on chunks (doc_slug, page);
-- HNSW con distancia coseno (los vectores llegan normalizados).
create index chunks_embedding_hnsw on chunks using hnsw (embedding vector_cosine_ops);

-- Top k por similitud coseno, por encima de un umbral y, si se pide, de un solo documento.
create or replace function match_chunks(
  query_embedding vector(768),
  k integer default 5,
  min_similarity double precision default 0.5,
  filtro_doc text default null
)
returns table (doc_slug text, titulo text, page integer, section text, contenido text, similarity double precision)
language sql stable
as $$
  select c.doc_slug, d.titulo, c.page, c.section, c.contenido, 1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  join documents d on d.slug = c.doc_slug
  where (filtro_doc is null or c.doc_slug = filtro_doc)
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit least(k, 50);
$$;

-- Solo el servidor (clave secreta) escribe y busca: sin políticas públicas.
alter table documents enable row level security;
alter table chunks enable row level security;
