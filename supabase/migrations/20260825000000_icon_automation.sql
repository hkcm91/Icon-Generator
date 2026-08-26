create table if not exists public.icon_automation_jobs (
  id uuid primary key,
  owner_key text not null,
  idempotency_key text not null,
  name text not null,
  status text not null check (status in ('queued', 'running', 'canceling', 'partial', 'succeeded', 'failed', 'canceled')),
  recipe jsonb not null,
  estimate jsonb not null,
  max_cost_usd numeric(12, 4) not null,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (owner_key, idempotency_key)
);

create table if not exists public.icon_automation_items (
  id uuid primary key,
  job_id uuid not null references public.icon_automation_jobs(id) on delete cascade,
  item_key text not null,
  ordinal integer not null,
  payload jsonb not null,
  status text not null check (status in ('queued', 'starting', 'running', 'succeeded', 'failed', 'canceled')),
  attempt integer not null default 0,
  provider_prediction_id text,
  output_urls jsonb not null default '[]'::jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, item_key)
);

create index if not exists icon_automation_items_queue_idx
  on public.icon_automation_items (job_id, status, ordinal);

alter table public.icon_automation_jobs enable row level security;
alter table public.icon_automation_items enable row level security;

create or replace function public.icon_automation_claim_items(p_job_id uuid, p_limit integer)
returns setof public.icon_automation_items
language sql
volatile
security definer
set search_path = public
as $$
  with candidates as (
    select id
    from public.icon_automation_items
    where job_id = p_job_id and status = 'queued'
    order by ordinal
    for update skip locked
    limit greatest(0, least(p_limit, 3))
  )
  update public.icon_automation_items as item
  set status = 'starting', attempt = item.attempt + 1, updated_at = now()
  from candidates
  where item.id = candidates.id
  returning item.*;
$$;

revoke all on function public.icon_automation_claim_items(uuid, integer) from public, anon, authenticated;
grant execute on function public.icon_automation_claim_items(uuid, integer) to service_role;

insert into storage.buckets (id, name, public)
values ('icon-automation', 'icon-automation', true)
on conflict (id) do update set public = excluded.public;
