// A new repo starts on this machine as ~/git/<name> with a private GitHub origin, so the
// other machines can clone it when a session starts there.
import { exec } from "herdr";
import { machineInfo, self } from "./machines.js";

export const REPO_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)?$/;

// The owner comes from a sibling repo's GitHub origin in the same group folder, so
// acme/crm lands in the acme org; otherwise the signed-in account.
const CREATE = `set -e
base="$1"; repo="$2"; name=$(basename "$repo"); group=$(dirname "$repo")
owner=""
if [ "$group" != "." ]; then
  for d in "$base/$group"/*/; do
    url=$(git -C "$d" remote get-url origin 2>/dev/null) || continue
    case "$url" in *github.com[:/]*) owner=$(printf %s "$url" | sed -E 's#^.*github\\.com[:/]([^/]+)/.*$#\\1#'); break ;; esac
  done
fi
[ -n "$owner" ] || owner=$(gh api user --jq .login)
mkdir -p "$base/$repo"
cd "$base/$repo"
[ -e .git ] || git init -q -b main
gh repo create "$owner/$name" --private --source . --remote origin >/dev/null
echo "$owner/$name"`;

export async function createRepo(repo) {
  const home = machineInfo().homes?.[self()];
  if (!home) throw new Error("This machine's home folder isn't known yet");
  const result = await exec("sh", ["-c", CREATE, "sh", `${home}/git`, repo]);
  if (result.code !== 0) throw new Error(result.stderr.trim().split("\n").pop() || `Couldn't create ${repo}`);
  return result.stdout.trim();
}
