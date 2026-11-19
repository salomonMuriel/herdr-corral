import json
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor

from cleanup_lib.models import PullRequest, RepoHistory

GITHUB_SLUG = re.compile(r"github\.com[:/]([^/]+/[^/]+?)(?:\.git)?/?$")
PR_LIMIT = "300"


def github_slug(origin: str | None) -> str | None:
    if not origin:
        return None
    match = GITHUB_SLUG.search(origin)
    return match.group(1) if match else None


def gh_json(args: list[str]) -> list[dict]:
    result = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip()[:200])
    return json.loads(result.stdout or "[]")


def merged_pulls(slug: str) -> list[PullRequest]:
    rows = gh_json(["pr", "list", "-R", slug, "--state", "merged", "--limit", PR_LIMIT,
                    "--json", "number,headRefName,headRefOid"])
    return [
        PullRequest(number=row["number"], head_ref=row["headRefName"], head_oid=row["headRefOid"])
        for row in rows
    ]


def closed_unmerged_heads(slug: str) -> set[str]:
    rows = gh_json(["pr", "list", "-R", slug, "--state", "closed", "--limit", PR_LIMIT,
                    "--json", "headRefName,mergedAt"])
    return {row["headRefName"] for row in rows if not row.get("mergedAt")}


def live_branches(slug: str) -> set[str]:
    result = subprocess.run(
        ["gh", "api", "--paginate", f"repos/{slug}/branches?per_page=100", "--jq", ".[].name"],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip()[:200])
    return set(result.stdout.split())


def repo_history(slug: str) -> RepoHistory | str:
    try:
        return RepoHistory(
            merged=merged_pulls(slug),
            closed_unmerged_heads=closed_unmerged_heads(slug),
            live_branches=live_branches(slug),
        )
    except (RuntimeError, json.JSONDecodeError, subprocess.TimeoutExpired) as error:
        return f"GitHub lookup failed: {error}"


def histories(slugs: set[str]) -> dict[str, RepoHistory | str]:
    ordered = sorted(slugs)
    with ThreadPoolExecutor(6) as pool:
        return dict(zip(ordered, pool.map(repo_history, ordered)))
