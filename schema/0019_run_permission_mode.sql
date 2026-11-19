-- The mode Claude Code starts a run's agents in: 'auto' or 'plan'. Null starts it with the
-- machine's own default (runs from hb start and schedules).
alter table runs add column if not exists permission_mode text;
