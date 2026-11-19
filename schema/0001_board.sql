-- The board's schema: projects, repos, tasks, dependencies, runs, history, cleanup,
-- Today, coordinators. Applied once by scripts/migrate to an empty database; later
-- changes go in new numbered files.

set check_function_bodies = false;

begin;

CREATE FUNCTION log_task_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  perform task_event(old, 'deleted',
    jsonb_build_object('row', to_jsonb(old),
      'waits_on', coalesce((select jsonb_agg(depends_on) from task_deps where task_id = old.id), '[]'::jsonb),
      'blocks', coalesce((select jsonb_agg(task_id) from task_deps where depends_on = old.id), '[]'::jsonb)),
    null);
  return old;
end $$;

CREATE FUNCTION log_task_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  perform task_event(new,
    case when current_setting('herdr.restoring', true) = new.id then 'restored' else 'created' end,
    null, jsonb_build_object('status', new.status, 'title', new.title));
  return null;
end $$;

CREATE FUNCTION log_task_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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

CREATE TABLE tasks (
    id text NOT NULL,
    project_id text NOT NULL,
    subproject_id text,
    title text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'todo'::text NOT NULL,
    "position" double precision DEFAULT 0 NOT NULL,
    tab text,
    machine text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    done_at timestamp with time zone,
    importance text DEFAULT 'normal'::text NOT NULL,
    report text,
    report_kind text,
    reported_at timestamp with time zone,
    needs_review boolean,
    review_waived boolean DEFAULT false NOT NULL,
    waiver_quote text,
    base text DEFAULT 'main'::text NOT NULL,
    branch text,
    cleanup text,
    cleanup_kind text,
    cleanup_at timestamp with time zone,
    code_review boolean,
    code_review_state text,
    code_review_round integer DEFAULT 0 NOT NULL,
    code_review_open integer,
    code_review_findings text,
    code_review_at timestamp with time zone,
    issue_url text,
    issue_commented_at timestamp with time zone,
    CONSTRAINT tasks_base_check CHECK ((base = ANY (ARRAY['main'::text, 'stack'::text]))),
    CONSTRAINT tasks_cleanup_kind_check CHECK ((cleanup_kind = ANY (ARRAY['removed'::text, 'kept'::text, 'waiting'::text]))),
    CONSTRAINT tasks_code_review_state_check CHECK ((code_review_state = ANY (ARRAY['queued'::text, 'running'::text, 'fixing'::text, 'passed'::text, 'failed'::text]))),
    CONSTRAINT tasks_importance_check CHECK ((importance = ANY (ARRAY['urgent'::text, 'high'::text, 'normal'::text, 'low'::text]))),
    CONSTRAINT tasks_report_kind_check CHECK ((report_kind = ANY (ARRAY['done'::text, 'ask'::text, 'note'::text])))
);

CREATE FUNCTION task_event(task tasks, kind text, before jsonb, after jsonb) RETURNS void
    LANGUAGE sql
    AS $$
  insert into task_events (task_id, project_id, title, kind, actor, machine, before, after)
  values (task.id, task.project_id, task.title, kind,
    coalesce(nullif(current_setting('herdr.actor', true), ''), 'unknown'),
    nullif(current_setting('herdr.machine', true), ''), before, after)
$$;

CREATE TABLE cleanup_runs (
    id bigint NOT NULL,
    ran_at timestamp with time zone DEFAULT now() NOT NULL,
    machine text NOT NULL,
    removed jsonb DEFAULT '[]'::jsonb NOT NULL,
    review jsonb DEFAULT '[]'::jsonb NOT NULL,
    neon jsonb DEFAULT '[]'::jsonb NOT NULL,
    skipped jsonb DEFAULT '{}'::jsonb NOT NULL
);

ALTER TABLE cleanup_runs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME cleanup_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE coordinators (
    project_id text NOT NULL,
    machine text NOT NULL,
    tab text NOT NULL,
    note text,
    noted_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE deployments (
    id bigint NOT NULL,
    sha text NOT NULL,
    deployed_at timestamp with time zone DEFAULT now() NOT NULL,
    deployed_by text NOT NULL
);

ALTER TABLE deployments ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME deployments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE digests (
    day date NOT NULL,
    body jsonb NOT NULL,
    text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE project_icons (
    project_id text NOT NULL,
    ext text NOT NULL,
    data text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE projects (
    id text NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'company'::text NOT NULL,
    color text,
    "position" double precision DEFAULT 0 NOT NULL,
    archived boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    icon text,
    review_mode text DEFAULT 'every'::text NOT NULL,
    code_review boolean DEFAULT false NOT NULL,
    CONSTRAINT projects_review_mode_check CHECK ((review_mode = ANY (ARRAY['every'::text, 'free'::text, 'per_task'::text])))
);

CREATE TABLE runs (
    id text NOT NULL,
    project_id text NOT NULL,
    root_task_id text,
    task_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    machine text NOT NULL,
    agent text NOT NULL,
    review_mode text,
    status text DEFAULT 'active'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    started_by text DEFAULT 'person'::text NOT NULL,
    permission_mode text,
    CONSTRAINT runs_review_mode_check CHECK ((review_mode = ANY (ARRAY['every'::text, 'free'::text, 'code'::text, 'both'::text]))),
    CONSTRAINT runs_status_check CHECK ((status = ANY (ARRAY['active'::text, 'stopped'::text, 'done'::text])))
);

CREATE TABLE schedule_runs (
    id text NOT NULL,
    schedule_id text NOT NULL,
    due_at timestamp with time zone NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    reason text,
    summary text,
    note text,
    terminal text,
    worktree text,
    branch text,
    task_id text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    CONSTRAINT schedule_runs_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'running'::text, 'done'::text, 'failed'::text, 'missed'::text])))
);

CREATE TABLE schedules (
    id text NOT NULL,
    name text NOT NULL,
    cron text NOT NULL,
    project_id text NOT NULL,
    subproject_id text NOT NULL,
    machine text NOT NULL,
    agent text DEFAULT 'claude'::text NOT NULL,
    prompt text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE subprojects (
    id text NOT NULL,
    project_id text NOT NULL,
    name text NOT NULL,
    repo text,
    paths jsonb DEFAULT '{}'::jsonb NOT NULL,
    "position" double precision DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE task_deps (
    task_id text NOT NULL,
    depends_on text NOT NULL,
    CONSTRAINT task_deps_check CHECK ((task_id <> depends_on))
);

CREATE TABLE task_events (
    id bigint NOT NULL,
    task_id text NOT NULL,
    project_id text NOT NULL,
    title text NOT NULL,
    kind text NOT NULL,
    actor text DEFAULT 'unknown'::text NOT NULL,
    machine text,
    before jsonb,
    after jsonb,
    at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT task_events_kind_check CHECK ((kind = ANY (ARRAY['created'::text, 'restored'::text, 'moved'::text, 'started'::text, 'report'::text, 'edited'::text, 'deleted'::text])))
);

CREATE SEQUENCE task_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE task_events_id_seq OWNED BY task_events.id;

CREATE TABLE task_repos (
    task_id text NOT NULL,
    subproject_id text NOT NULL,
    tab text,
    machine text,
    branch text,
    cleanup text,
    cleanup_kind text,
    cleanup_at timestamp with time zone,
    "position" double precision DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT task_repos_cleanup_kind_check CHECK ((cleanup_kind = ANY (ARRAY['removed'::text, 'kept'::text, 'waiting'::text])))
);

CREATE TABLE today_picks (
    day date NOT NULL,
    task_id text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    picked_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY task_events ALTER COLUMN id SET DEFAULT nextval('task_events_id_seq'::regclass);

ALTER TABLE ONLY cleanup_runs
    ADD CONSTRAINT cleanup_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY coordinators
    ADD CONSTRAINT coordinators_pkey PRIMARY KEY (project_id);

ALTER TABLE ONLY deployments
    ADD CONSTRAINT deployments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY digests
    ADD CONSTRAINT digests_pkey PRIMARY KEY (day);

ALTER TABLE ONLY project_icons
    ADD CONSTRAINT project_icons_pkey PRIMARY KEY (project_id);

ALTER TABLE ONLY projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);

ALTER TABLE ONLY runs
    ADD CONSTRAINT runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY schedule_runs
    ADD CONSTRAINT schedule_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY schedule_runs
    ADD CONSTRAINT schedule_runs_schedule_id_due_at_key UNIQUE (schedule_id, due_at);

ALTER TABLE ONLY schedules
    ADD CONSTRAINT schedules_pkey PRIMARY KEY (id);

ALTER TABLE ONLY subprojects
    ADD CONSTRAINT subprojects_pkey PRIMARY KEY (id);

ALTER TABLE ONLY task_deps
    ADD CONSTRAINT task_deps_pkey PRIMARY KEY (task_id, depends_on);

ALTER TABLE ONLY task_events
    ADD CONSTRAINT task_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY task_repos
    ADD CONSTRAINT task_repos_pkey PRIMARY KEY (task_id, subproject_id);

ALTER TABLE ONLY tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY today_picks
    ADD CONSTRAINT today_picks_pkey PRIMARY KEY (day, task_id);

CREATE INDEX runs_active ON runs USING btree (project_id) WHERE (status = 'active'::text);

CREATE INDEX schedule_runs_open ON schedule_runs USING btree (schedule_id) WHERE ((status = ANY (ARRAY['scheduled'::text, 'running'::text])) OR ((status = ANY (ARRAY['done'::text, 'failed'::text])) AND (task_id IS NULL)));

CREATE INDEX task_events_at ON task_events USING btree (at DESC);

CREATE INDEX task_events_project ON task_events USING btree (project_id, at DESC);

CREATE INDEX task_events_task ON task_events USING btree (task_id, at DESC);

CREATE INDEX task_repos_tab ON task_repos USING btree (tab) WHERE (tab IS NOT NULL);

CREATE UNIQUE INDEX tasks_issue_url ON tasks USING btree (project_id, issue_url) WHERE (issue_url IS NOT NULL);

CREATE INDEX tasks_project ON tasks USING btree (project_id, status, "position");

CREATE INDEX today_picks_task ON today_picks USING btree (task_id);

CREATE TRIGGER task_events_delete BEFORE DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION log_task_delete();

CREATE TRIGGER task_events_insert AFTER INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION log_task_insert();

CREATE TRIGGER task_events_update AFTER UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION log_task_update();

ALTER TABLE ONLY coordinators
    ADD CONSTRAINT coordinators_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY project_icons
    ADD CONSTRAINT project_icons_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY runs
    ADD CONSTRAINT runs_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY runs
    ADD CONSTRAINT runs_root_task_id_fkey FOREIGN KEY (root_task_id) REFERENCES tasks(id) ON DELETE SET NULL;

ALTER TABLE ONLY schedule_runs
    ADD CONSTRAINT schedule_runs_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE;

ALTER TABLE ONLY schedule_runs
    ADD CONSTRAINT schedule_runs_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;

ALTER TABLE ONLY schedules
    ADD CONSTRAINT schedules_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY schedules
    ADD CONSTRAINT schedules_subproject_id_fkey FOREIGN KEY (subproject_id) REFERENCES subprojects(id) ON DELETE CASCADE;

ALTER TABLE ONLY subprojects
    ADD CONSTRAINT subprojects_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY task_deps
    ADD CONSTRAINT task_deps_depends_on_fkey FOREIGN KEY (depends_on) REFERENCES tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY task_deps
    ADD CONSTRAINT task_deps_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY task_repos
    ADD CONSTRAINT task_repos_subproject_id_fkey FOREIGN KEY (subproject_id) REFERENCES subprojects(id) ON DELETE CASCADE;

ALTER TABLE ONLY task_repos
    ADD CONSTRAINT task_repos_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY tasks
    ADD CONSTRAINT tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY tasks
    ADD CONSTRAINT tasks_subproject_id_fkey FOREIGN KEY (subproject_id) REFERENCES subprojects(id) ON DELETE SET NULL;

ALTER TABLE ONLY today_picks
    ADD CONSTRAINT today_picks_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;

commit;
