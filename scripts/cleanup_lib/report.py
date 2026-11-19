from collections import defaultdict

from cleanup_lib.models import Item

DAY = 86400


def human_size(size_bytes: int) -> str:
    size = float(size_bytes)
    for unit in ("B", "K", "M", "G"):
        if size < 1024:
            return f"{size:.0f}{unit}" if unit in ("B", "K") else f"{size:.1f}{unit}"
        size /= 1024
    return f"{size:.1f}T"


def human_age(seconds: int) -> str:
    if seconds <= 0:
        return "?"
    days = seconds // DAY
    if days < 1:
        return f"{seconds // 3600}h"
    if days < 14:
        return f"{days}d"
    if days < 60:
        return f"{days // 7}w"
    return f"{days // 30}mo"


def ordered(items: list[Item]) -> list[Item]:
    return sorted(items, key=lambda item: (not item.safe, item.kind, -item.size_bytes))


def print_table(items: list[Item]) -> None:
    width = max((len(item.label) for item in items), default=10)
    print(f"{'#':>3}  {'item':<{width}}  {'machine':<13}  {'size':>7}  {'age':>4}  verdict")
    for number, item in enumerate(items, 1):
        mark = f"{number:>3}" if item.safe else "  -"
        verdict = f"{'safe' if item.safe else 'review' if item.review else 'keep'}: {item.reason}"
        print(f"{mark}  {item.label:<{width}}  {item.machine:<13}  "
              f"{human_size(item.size_bytes):>7}  {human_age(item.age_seconds):>4}  {verdict}")


def print_totals(items: list[Item]) -> None:
    totals: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    for item in items:
        bucket = totals[item.machine]
        bucket[0] += item.size_bytes
        if item.safe:
            bucket[1] += item.size_bytes
            bucket[2] += 1
    print()
    for machine, (total, safe_size, safe_count) in sorted(totals.items()):
        print(f"{machine}: {human_size(total)} total, {safe_count} safe to remove ({human_size(safe_size)})")


def parse_selection(text: str, allowed: set[int]) -> set[int]:
    text = text.strip().lower()
    if not text:
        return set()
    if text == "all":
        return set(allowed)
    chosen: set[int] = set()
    for part in text.replace(" ", "").split(","):
        start, _, end = part.partition("-")
        if not start.isdigit() or (end and not end.isdigit()):
            raise ValueError(f"not a number or range: {part}")
        chosen.update(range(int(start), int(end or start) + 1))
    rejected = chosen - allowed
    if rejected:
        raise ValueError(f"not safe to remove: {', '.join(map(str, sorted(rejected)))}")
    return chosen
