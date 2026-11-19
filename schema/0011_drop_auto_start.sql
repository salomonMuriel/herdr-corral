-- Runs replaced the per-task and per-project auto-start marks from 0007.
alter table tasks drop column if exists auto_start;
alter table tasks drop column if exists agent;
alter table projects drop column if exists auto_start_all;
alter table projects drop column if exists auto_machine;
alter table projects drop column if exists auto_agent;
