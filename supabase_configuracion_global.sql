-- Ejecuta este script en Supabase SQL Editor para habilitar
-- configuración global compartida entre todos los usuarios/dispositivos.

create table if not exists public.configuracion_global (
  clave text primary key,
  valor jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

alter table public.configuracion_global enable row level security;

drop policy if exists "lectura_global_configuracion" on public.configuracion_global;
create policy "lectura_global_configuracion"
on public.configuracion_global
for select
to anon, authenticated
using (true);

drop policy if exists "edicion_global_desde_auth" on public.configuracion_global;
create policy "edicion_global_desde_auth"
on public.configuracion_global
for all
to authenticated
using (true)
with check (true);
