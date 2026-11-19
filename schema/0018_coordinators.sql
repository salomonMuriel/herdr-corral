-- One coordinator agent per project: a Claude Code session that plans the project's tasks,
-- starts agents on them and passes on what needs the person. It never writes code.
-- tab is its Herdr tab ("desk/tb12"); note is its last hb note.
create table if not exists coordinators (
  project_id text primary key references projects(id) on delete cascade,
  machine text not null,
  tab text not null,
  note text,
  noted_at timestamptz,
  started_at timestamptz not null default now()
);

-- Who started a run: 'person' from the board, 'coordinator' from hb start.
alter table runs add column if not exists started_by text not null default 'person';
