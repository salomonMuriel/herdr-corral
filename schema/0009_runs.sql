-- A run starts its tasks as they become Ready, on one machine with one agent, until each
-- is Done or someone stops it. root_task_id is the task a chain run started from; null
-- for a run of selected tasks. review_mode null leaves each task's own review setting.
create table if not exists runs (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  root_task_id text references tasks(id) on delete set null,
  task_ids jsonb not null default '[]'::jsonb,
  machine text not null,
  agent text not null,
  review_mode text check (review_mode in ('every', 'free')),
  status text not null default 'active' check (status in ('active', 'stopped', 'done')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists runs_active on runs(project_id) where status = 'active';
