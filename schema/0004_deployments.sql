create table if not exists deployments (
  id bigint generated always as identity primary key,
  sha text not null,
  deployed_at timestamptz not null default now(),
  deployed_by text not null
);
