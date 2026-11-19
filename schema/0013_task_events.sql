-- Every change to a task, written by a trigger so no writer can skip it. Writers say who they
-- are in the same transaction: select set_config('herdr.actor', 'person', true),
-- set_config('herdr.machine', 'laptop', true). before holds the values a change replaced,
-- so it can be put back; a deleted task's before is its whole row plus its dependencies.
create table if not exists task_events (
  id bigserial primary key,
  task_id text not null,
  project_id text not null,
  title text not null,
  kind text not null check (kind in ('created', 'restored', 'moved', 'started', 'report', 'edited', 'deleted')),
  actor text not null default 'unknown',
  machine text,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

create index if not exists task_events_task on task_events(task_id, at desc);
create index if not exists task_events_project on task_events(project_id, at desc);
create index if not exists task_events_at on task_events(at desc);

create or replace function task_event(task tasks, kind text, before jsonb, after jsonb) returns void
language sql as $$
  insert into task_events (task_id, project_id, title, kind, actor, machine, before, after)
  values (task.id, task.project_id, task.title, kind,
    coalesce(nullif(current_setting('herdr.actor', true), ''), 'unknown'),
    nullif(current_setting('herdr.machine', true), ''), before, after)
$$;

create or replace function log_task_insert() returns trigger
language plpgsql as $$
begin
  perform task_event(new,
    case when current_setting('herdr.restoring', true) = new.id then 'restored' else 'created' end,
    null, jsonb_build_object('status', new.status, 'title', new.title));
  return null;
end $$;

-- Reordering inside a column and the cleanup columns aren't history; the waiver follows the notes.
create or replace function log_task_update() returns trigger
language plpgsql as $$
declare
  edited text[] := array['title', 'notes', 'importance', 'subproject_id', 'needs_review', 'code_review', 'base'];
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
  changed text[];
begin
  if new.status is distinct from old.status then
    perform task_event(new, 'moved',
      jsonb_build_object('status', old.status, 'position', old.position),
      jsonb_build_object('status', new.status, 'position', new.position));
  end if;
  if new.tab is not null and new.tab is distinct from old.tab then
    perform task_event(new, 'started', null,
      jsonb_build_object('tab', new.tab, 'machine', new.machine, 'branch', new.branch));
  end if;
  if new.report is not null and (new.report is distinct from old.report or new.reported_at is distinct from old.reported_at) then
    perform task_event(new, 'report', null, jsonb_build_object('kind', new.report_kind, 'text', new.report));
  end if;
  select array_agg(key) into changed from unnest(edited) as key where old_row -> key is distinct from new_row -> key;
  if changed is not null then
    perform task_event(new, 'edited',
      (select jsonb_object_agg(key, old_row -> key) from unnest(changed) as key),
      (select jsonb_object_agg(key, new_row -> key) from unnest(changed) as key));
  end if;
  return null;
end $$;

-- Before the delete, while its dependencies still exist.
create or replace function log_task_delete() returns trigger
language plpgsql as $$
begin
  perform task_event(old, 'deleted',
    jsonb_build_object('row', to_jsonb(old),
      'waits_on', coalesce((select jsonb_agg(depends_on) from task_deps where task_id = old.id), '[]'::jsonb),
      'blocks', coalesce((select jsonb_agg(task_id) from task_deps where depends_on = old.id), '[]'::jsonb)),
    null);
  return old;
end $$;

drop trigger if exists task_events_insert on tasks;
create trigger task_events_insert after insert on tasks for each row execute function log_task_insert();
drop trigger if exists task_events_update on tasks;
create trigger task_events_update after update on tasks for each row execute function log_task_update();
drop trigger if exists task_events_delete on tasks;
create trigger task_events_delete before delete on tasks for each row execute function log_task_delete();
