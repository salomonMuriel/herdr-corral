-- A Claude code review between hb done and the next step. projects.code_review is the
-- project's default; tasks.code_review overrides it (null follows the project).
-- code_review_state: queued (hb done asked for one), running, fixing (findings sent to the
-- task's agent), passed, failed (still open after the last round, or the review broke).
alter table projects add column if not exists code_review boolean not null default false;
alter table tasks add column if not exists code_review boolean;
alter table tasks add column if not exists code_review_state text
  check (code_review_state in ('queued', 'running', 'fixing', 'passed', 'failed'));
alter table tasks add column if not exists code_review_round integer not null default 0;
alter table tasks add column if not exists code_review_open integer;
alter table tasks add column if not exists code_review_findings text;
alter table tasks add column if not exists code_review_at timestamptz;

-- A run's review choice: free (none), code, every (your review) or both.
alter table runs drop constraint if exists runs_review_mode_check;
alter table runs add constraint runs_review_mode_check check (review_mode in ('every', 'free', 'code', 'both'));
