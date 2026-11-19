-- What happened to a Done task's worktree: removed, kept (with why) or waiting for its
-- branch to reach main.
alter table tasks add column if not exists cleanup text;
alter table tasks add column if not exists cleanup_kind text check (cleanup_kind in ('removed', 'kept', 'waiting'));
alter table tasks add column if not exists cleanup_at timestamptz;
