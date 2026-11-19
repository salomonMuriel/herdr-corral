-- Tasks imported from GitHub issues. issue_url links the task to its issue; the unique index
-- keeps both windows from importing the same issue twice. issue_commented_at is set when a
-- window claims the Done comment, so only one of them posts it.
alter table tasks add column if not exists issue_url text;
alter table tasks add column if not exists issue_commented_at timestamptz;
create unique index if not exists tasks_issue_url on tasks(project_id, issue_url) where issue_url is not null;
