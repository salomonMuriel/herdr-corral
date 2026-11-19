-- The repos a task works in besides its own (tasks.subproject_id, where runs start it and whose
-- agent's hb done moves the card), each with the session, machine and branch an agent took
-- there and what happened to that worktree once the task was Done.
create table if not exists task_repos (
  task_id text not null references tasks(id) on delete cascade,
  subproject_id text not null references subprojects(id) on delete cascade,
  tab text,
  machine text,
  branch text,
  cleanup text,
  cleanup_kind text check (cleanup_kind in ('removed', 'kept', 'waiting')),
  cleanup_at timestamptz,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (task_id, subproject_id)
);

create index if not exists task_repos_tab on task_repos(tab) where tab is not null;
