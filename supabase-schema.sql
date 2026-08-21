create table if not exists public.command_center_state (
  id text primary key,
  dashboard jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.command_center_state enable row level security;

drop policy if exists "Command Center can read dashboard state" on public.command_center_state;
create policy "Command Center can read dashboard state"
on public.command_center_state
for select
to anon
using (id = 'main');

drop policy if exists "Command Center can write dashboard state" on public.command_center_state;
create policy "Command Center can write dashboard state"
on public.command_center_state
for all
to anon
using (id = 'main')
with check (id = 'main');
