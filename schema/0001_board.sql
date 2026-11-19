create table if not exists projects (
  id text primary key,
  name text not null,
  kind text not null default 'company',
  color text,
  position double precision not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists subprojects (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  name text not null,
  repo text,
  paths jsonb not null default '{}'::jsonb,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tasks (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  subproject_id text references subprojects(id) on delete set null,
  title text not null,
  notes text not null default '',
  status text not null default 'todo',
  position double precision not null default 0,
  tab text,
  machine text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz
);

create index if not exists tasks_project on tasks(project_id, status, position);
