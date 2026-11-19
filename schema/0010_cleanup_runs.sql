-- One row per nightly cleanup: what it removed, what is left to review, branches per Neon
-- project, and the machines or services it couldn't reach.
create table if not exists cleanup_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  machine text not null,
  removed jsonb not null default '[]',
  review jsonb not null default '[]',
  neon jsonb not null default '[]',
  skipped jsonb not null default '{}'
);
