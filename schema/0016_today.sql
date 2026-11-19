-- The Today view's picks: up to three tasks the person means to finish on a day (their local date).
create table if not exists today_picks (
  day date not null,
  task_id text not null references tasks(id) on delete cascade,
  position integer not null default 0,
  picked_at timestamptz not null default now(),
  primary key (day, task_id)
);

create index if not exists today_picks_task on today_picks(task_id);

-- The Pi's end-of-day digest, one per day (Pi local date). body holds the sections the
-- Today view draws; text is what the phone push said.
create table if not exists digests (
  day date primary key,
  body jsonb not null,
  text text not null,
  created_at timestamptz not null default now()
);
