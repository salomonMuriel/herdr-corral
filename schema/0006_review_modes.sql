alter table projects add column if not exists review_mode text not null default 'every'
  check (review_mode in ('every', 'free', 'per_task'));
alter table tasks add column if not exists needs_review boolean;
alter table tasks add column if not exists review_waived boolean not null default false;
alter table tasks add column if not exists waiver_quote text;
