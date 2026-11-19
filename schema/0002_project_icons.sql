alter table projects add column if not exists icon text;

create table if not exists project_icons (
  project_id text primary key references projects(id) on delete cascade,
  ext text not null,
  data text not null,
  updated_at timestamptz not null default now()
);
