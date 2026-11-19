alter table tasks add column if not exists importance text not null default 'normal'
  check (importance in ('urgent', 'high', 'normal', 'low'));

create table if not exists task_deps (
  task_id text not null references tasks(id) on delete cascade,
  depends_on text not null references tasks(id) on delete cascade,
  primary key (task_id, depends_on),
  check (task_id <> depends_on)
);
