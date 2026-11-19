"""Read keys.json on stdin, replace the sections the fragment defines for a platform, print the result."""
import json
import sys


def merge_keys(keys: dict, fragment: dict, platform: str) -> dict:
    sections = fragment.get(platform)
    if sections is None:
        raise SystemExit(f"Fragment has no '{platform}' section")
    return {**keys, **sections}


def main() -> None:
    fragment_path, platform = sys.argv[1], sys.argv[2]
    with open(fragment_path) as fragment_file:
        fragment = json.load(fragment_file)
    keys = json.load(sys.stdin)
    json.dump(merge_keys(keys, fragment, platform), sys.stdout, indent=2)


if __name__ == "__main__":
    main()
