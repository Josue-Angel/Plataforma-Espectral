-- Ejecuta este script en Supabase SQL Editor para guardar evidencia auditable
-- del consentimiento informado desde la tabla public.perfiles.
--
-- IMPORTANTE: esta versión corrige el error 42P17 de "infinite recursion"
-- evitando consultar public.perfiles directamente dentro de las políticas RLS.

alter table public.perfiles
  add column if not exists nombre_completo text,
  add column if not exists consentimiento boolean not null default false,
  add column if not exists consentimiento_aceptado_en timestamptz,
  add column if not exists consentimiento_version text,
  add column if not exists consentimiento_documento text,
  add column if not exists consentimiento_frase text,
  add column if not exists consentimiento_metodo text,
  add column if not exists test_fototipo_completado boolean not null default false,
  add column if not exists estado_acceso text not null default 'activo';

create index if not exists perfiles_consentimiento_idx
  on public.perfiles (consentimiento, consentimiento_aceptado_en desc);

alter table public.perfiles enable row level security;

-- Función SECURITY DEFINER para leer el rol del usuario actual sin disparar
-- recursión de RLS en public.perfiles.
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

drop policy if exists "perfiles_select_autenticados" on public.perfiles;
drop policy if exists "perfiles_update_propietario_o_admin" on public.perfiles;

create policy "perfiles_select_autenticados"
on public.perfiles
for select
to authenticated
using (
  id = auth.uid()
  or public.current_user_app_role() in ('admin', 'desarrollador')
);

create policy "perfiles_update_propietario_o_admin"
on public.perfiles
for update
to authenticated
using (
  id = auth.uid()
  or public.current_user_app_role() in ('admin', 'desarrollador')
)
with check (
  id = auth.uid()
  or public.current_user_app_role() in ('admin', 'desarrollador')
);

-- Permite que un usuario autenticado cree su propio perfil si aún no existe.
drop policy if exists "perfiles_insert_propietario" on public.perfiles;
create policy "perfiles_insert_propietario"
on public.perfiles
for insert
to authenticated
with check (id = auth.uid());

-- Crea automáticamente el perfil base al registrar usuarios en Auth.
create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfiles (id, email, nombre, role, estado_acceso)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', new.email, 'Voluntario'),
    'voluntario',
    'activo'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user_profile();
