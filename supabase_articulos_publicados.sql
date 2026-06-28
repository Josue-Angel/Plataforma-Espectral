-- Ejecuta este script en Supabase SQL Editor para habilitar la publicación
-- global de artículos, tesis y datasets desde la sección "Tesis y artículos".

create table if not exists public.articulos_publicados (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('propio', 'referencia')),
  anio integer not null check (anio between 1900 and 2100),
  titulo text not null,
  autores text not null,
  fuente text not null,
  url text,
  url2 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null
);

alter table public.articulos_publicados enable row level security;

-- Reutilizado por políticas RLS para validar rol sin recursión en public.perfiles.
create or replace function public.current_user_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(p.role, 'voluntario'))
  from public.perfiles p
  where p.id = auth.uid()
  limit 1
$$;

revoke all on function public.current_user_app_role() from public;
grant execute on function public.current_user_app_role() to authenticated;


create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists articulos_publicados_touch_updated_at on public.articulos_publicados;
create trigger articulos_publicados_touch_updated_at
before update on public.articulos_publicados
for each row execute function public.touch_updated_at();

drop policy if exists "articulos_select_publico" on public.articulos_publicados;
create policy "articulos_select_publico"
on public.articulos_publicados
for select
to anon, authenticated
using (true);

drop policy if exists "articulos_admin_insert" on public.articulos_publicados;
create policy "articulos_admin_insert"
on public.articulos_publicados
for insert
to authenticated
with check (public.current_user_app_role() in ('admin', 'desarrollador'));

drop policy if exists "articulos_admin_update" on public.articulos_publicados;
create policy "articulos_admin_update"
on public.articulos_publicados
for update
to authenticated
using (public.current_user_app_role() in ('admin', 'desarrollador'))
with check (public.current_user_app_role() in ('admin', 'desarrollador'));

drop policy if exists "articulos_admin_delete" on public.articulos_publicados;
create policy "articulos_admin_delete"
on public.articulos_publicados
for delete
to authenticated
using (public.current_user_app_role() in ('admin', 'desarrollador'));

insert into storage.buckets (id, name, public)
values ('articulos', 'articulos', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "articulos_storage_select_publico" on storage.objects;
create policy "articulos_storage_select_publico"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'articulos');

drop policy if exists "articulos_storage_admin_insert" on storage.objects;
create policy "articulos_storage_admin_insert"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'articulos' and public.current_user_app_role() in ('admin', 'desarrollador'));

drop policy if exists "articulos_storage_admin_update" on storage.objects;
create policy "articulos_storage_admin_update"
on storage.objects
for update
to authenticated
using (bucket_id = 'articulos' and public.current_user_app_role() in ('admin', 'desarrollador'))
with check (bucket_id = 'articulos' and public.current_user_app_role() in ('admin', 'desarrollador'));

drop policy if exists "articulos_storage_admin_delete" on storage.objects;
create policy "articulos_storage_admin_delete"
on storage.objects
for delete
to authenticated
using (bucket_id = 'articulos' and public.current_user_app_role() in ('admin', 'desarrollador'));
