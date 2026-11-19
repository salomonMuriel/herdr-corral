alter table tasks add column if not exists report text;
alter table tasks add column if not exists report_kind text check (report_kind in ('done', 'ask', 'note'));
alter table tasks add column if not exists reported_at timestamptz;
