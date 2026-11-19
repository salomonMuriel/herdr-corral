-- auto_start null follows the project's auto_start_all. machine doubles as the machine a
-- To do task auto-starts on, and agent is a knownAgents key.
alter table tasks add column if not exists auto_start boolean;
alter table tasks add column if not exists agent text;
alter table tasks add column if not exists base text not null default 'main' check (base in ('main', 'stack'));
alter table tasks add column if not exists branch text;
alter table projects add column if not exists auto_start_all boolean not null default false;
alter table projects add column if not exists auto_machine text;
alter table projects add column if not exists auto_agent text;
