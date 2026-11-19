-- An agent the Pi starts on a cron, each run in a fresh worktree. cron is five fields in
-- the Pi's local time. updated_at marks an edit: due times before it are never caught up.
create table if not exists schedules (
  id text primary key,
  name text not null,
  cron text not null,
  project_id text not null references projects(id) on delete cascade,
  subproject_id text not null references subprojects(id) on delete cascade,
  machine text not null,
  agent text not null default 'claude',
  prompt text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per due time. scheduled waits for its machine, running has a terminal,
-- missed never ran (the last run was still going, or a later run caught up).
-- task_id is the result card, written once the run is done or failed.
create table if not exists schedule_runs (
  id text primary key,
  schedule_id text not null references schedules(id) on delete cascade,
  due_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'running', 'done', 'failed', 'missed')),
  reason text,
  summary text,
  note text,
  terminal text,
  worktree text,
  branch text,
  task_id text references tasks(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  unique (schedule_id, due_at)
);

create index if not exists schedule_runs_open on schedule_runs(schedule_id)
  where status in ('scheduled', 'running') or (status in ('done', 'failed') and task_id is null);
