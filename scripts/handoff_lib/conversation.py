"""A Claude Code conversation: its transcript and the folder beside it (subagents, tool
results), copied into the target's project folder with the moved paths rewritten."""
import io
import json
import re
import tarfile
from dataclasses import dataclass

from handoff_lib.machines import HandoffError, run, shell

FIND = 'find "$HOME/.claude/projects" -mindepth 2 -maxdepth 2 -name "$1.jsonl" | head -1'
# COPYFILE_DISABLE: macOS tar would add AppleDouble files for extended attributes.
PACK = 'cd "$1" && export COPYFILE_DISABLE=1 && if [ -d "$2" ]; then tar -cf - "$2.jsonl" "$2"; else tar -cf - "$2.jsonl"; fi'
UNPACK = 'mkdir -p "$1" && tar -xf - -C "$1"'
ARCHIVE = 'mv "$1/$2.jsonl" "$1/$2.jsonl.moved-to-$3"'


@dataclass
class Conversation:
    machine: str
    session_id: str
    cwd: str
    folder: str


def project_folder(home: str, cwd: str) -> str:
    return f"{home}/.claude/projects/{re.sub(r'[^A-Za-z0-9]', '-', cwd)}"


def find(machine: str, pid: int) -> Conversation:
    raw = shell(machine, 'cat "$HOME/.claude/sessions/$1.json"', str(pid), what="reading the Claude Code session")
    record = json.loads(raw)
    transcript = shell(machine, FIND, record["sessionId"], what="finding the transcript")
    if not transcript:
        raise HandoffError(f"no transcript for session {record['sessionId']} on {machine}")
    return Conversation(machine=machine, session_id=record["sessionId"], cwd=record["cwd"],
                        folder=transcript.rsplit("/", 1)[0])


def rewrite(archive: bytes, replacements: list[tuple[str, str]]) -> bytes:
    """The same tar with each path replaced inside the transcripts (the main one and subagents')."""
    source = tarfile.open(fileobj=io.BytesIO(archive))
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode="w") as target:
        for member in source.getmembers():
            member.pax_headers = {}
            if not member.isfile():
                target.addfile(member)
                continue
            content = source.extractfile(member).read()
            if member.name.endswith(".jsonl"):
                text = content.decode()
                for old, new in replacements:
                    text = text.replace(old, new)
                content = text.encode()
                member.size = len(content)
            target.addfile(member, io.BytesIO(content))
    return result.getvalue()


def copy(conversation: Conversation, target_machine: str, target_folder: str, replacements: list[tuple[str, str]]) -> None:
    packed = run(conversation.machine, ["sh", "-c", PACK, "sh", conversation.folder, conversation.session_id])
    if packed.returncode != 0:
        raise HandoffError(f"couldn't pack the transcript on {conversation.machine}: {packed.stderr.decode().strip()[:300]}")
    payload = rewrite(packed.stdout, replacements)
    unpacked = run(target_machine, ["sh", "-c", UNPACK, "sh", target_folder], stdin=payload)
    if unpacked.returncode != 0:
        raise HandoffError(f"couldn't write the transcript on {target_machine}: {unpacked.stderr.decode().strip()[:300]}")


def archive(conversation: Conversation, target_machine: str) -> None:
    """Renamed so the source can't resume the same conversation alongside the moved one."""
    shell(conversation.machine, ARCHIVE, conversation.folder, conversation.session_id, target_machine,
          what="archiving the source transcript")
