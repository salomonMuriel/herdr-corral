import json
import shutil
import subprocess

import herdr_config
from cleanup_lib.models import NeonBranch

UNCONFIGURED = "neonctl not found or cleanup.neon_projects not set"


def neonctl_json(args: list[str]) -> list[dict] | dict:
    result = subprocess.run(["neonctl", *args, "-o", "json"], capture_output=True, text=True,
                            timeout=60, stdin=subprocess.DEVNULL)
    if result.returncode != 0:
        raise RuntimeError(f"neonctl {' '.join(args)}: {result.stderr.strip()[:200]}")
    return json.loads(result.stdout)


# Only projects named in the config are touched: neonctl may see a whole organization's.
def allowed_projects() -> set[str]:
    return set(herdr_config.get("cleanup.neon_projects", []) or [])


def available() -> bool:
    return shutil.which("neonctl") is not None and bool(allowed_projects())


def projects() -> list[dict]:
    allowed = allowed_projects()
    found = {project["id"]: project for project in neonctl_json(["projects", "list"])}
    for org in neonctl_json(["orgs", "list"]):
        found.update({project["id"]: project for project in neonctl_json(["projects", "list", "--org-id", org["id"]])})
    return [project for project in found.values() if project["id"] in allowed or project["name"] in allowed]


def project_branches(project: dict) -> list[NeonBranch]:
    rows = neonctl_json(["branches", "list", "--project-id", project["id"]])
    parents = {row.get("parent_id") for row in rows}
    return [
        NeonBranch(
            project_id=project["id"],
            project_name=project["name"],
            branch_id=row["id"],
            name=row["name"],
            is_default=bool(row.get("default")),
            has_children=row["id"] in parents,
            created_at=row["created_at"],
            size_bytes=int(row.get("logical_size") or 0),
        )
        for row in rows
    ]


def all_branches() -> list[NeonBranch]:
    return [branch for project in projects() for branch in project_branches(project)]


def delete_branch(branch: NeonBranch) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["neonctl", "branches", "delete", branch.branch_id, "--project-id", branch.project_id],
        capture_output=True, text=True, timeout=120, stdin=subprocess.DEVNULL,
    )
