-- Ejecuta este script en Supabase SQL Editor para guardar evidencia auditable
-- del consentimiento informado desde la tabla public.perfiles.

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

-- Para que el panel de gestión funcione, confirma que public.perfiles tenga RLS
-- con lectura/actualización permitida para los roles admin/desarrollador de tu app.
-- Si tu proyecto aún no tiene políticas, adapta estas políticas al modelo actual.

drop policy if exists "perfiles_select_autenticados" on public.perfiles;
create policy "perfiles_select_autenticados"
on public.perfiles
for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1 from public.perfiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role, 'voluntario')) in ('admin', 'desarrollador')
  )
);

drop policy if exists "perfiles_update_propietario_o_admin" on public.perfiles;
create policy "perfiles_update_propietario_o_admin"
on public.perfiles
for update
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1 from public.perfiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role, 'voluntario')) in ('admin', 'desarrollador')
  )
)
with check (
  id = auth.uid()
  or exists (
    select 1 from public.perfiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role, 'voluntario')) in ('admin', 'desarrollador')
  )
);
