import asyncio
import json
import urllib.request
from dataclasses import asdict, dataclass, field


@dataclass
class Push:
    title: str
    message: str
    click: str
    tags: list[str] = field(default_factory=list)
    priority: int = 3


class Ntfy:
    def __init__(self, url: str, topic: str):
        self.url = url.rstrip("/")
        self.topic = topic

    def body(self, push: Push) -> bytes:
        return json.dumps({"topic": self.topic, **asdict(push)}).encode()

    def post(self, push: Push) -> None:
        # JSON publishing keeps non-ASCII titles intact; ntfy headers are Latin-1 only.
        request = urllib.request.Request(
            self.url, data=self.body(push), headers={"Content-Type": "application/json"}, method="POST"
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            response.read()

    async def send(self, push: Push) -> None:
        await asyncio.to_thread(self.post, push)
