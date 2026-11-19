from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

from herdr_pi.attention import agents_view, screen_tail
from herdr_pi.board import Board, BoardError
from herdr_pi.remote import HcError
from herdr_pi.service import Service
from herdr_pi.web_approvals import add_approval_routes

STATIC = Path(__file__).with_name("web_static")
STATIC_FILES = {"page.css", "page.js", "api.js", "forms.js", "approval.js"}
LOGIN_HEADER = "tailscale-user-login"
ALLOWED_KEYS = {"1", "2", "3", "4", "enter", "esc", "up", "down", "tab", "shift+tab", "ctrl+c"}


class Target(BaseModel):
    machine: str
    address: str


class SendBody(Target):
    text: str = Field(min_length=1, max_length=20_000)
    force: bool = False


class KeysBody(Target):
    keys: list[str] = Field(min_length=1, max_length=8)


class TaskBody(BaseModel):
    project_id: str
    subproject_id: str | None = None
    title: str = Field(min_length=1, max_length=300)
    notes: str = Field(default="", max_length=20_000)


def same_origin(request: Request) -> bool:
    """Cross-site pages can't send JSON here without a preflight, and an Origin from elsewhere is refused."""
    if not request.headers.get("content-type", "").startswith("application/json"):
        return False
    origin = request.headers.get("origin")
    return origin is None or urlsplit(origin).netloc == request.headers.get("host")


def create_web_app(service: Service, board: Board) -> FastAPI:
    app = FastAPI(title="herdr-pi web", docs_url=None, redoc_url=None, openapi_url=None)
    store = service.store
    remote = service.remote
    logins = set(service.settings.web_logins)

    # Only tailscale serve reaches this listener, and it sets the login for devices owned by a person.
    @app.middleware("http")
    async def check_identity(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        login = request.headers.get(LOGIN_HEADER)
        if not login or login not in logins:
            return Response("Not yours", status_code=403, media_type="text/plain")
        if request.method != "GET" and not same_origin(request):
            return Response("Bad origin", status_code=403, media_type="text/plain")
        return await call_next(request)

    @app.exception_handler(HcError)
    async def hc_failed(request: Request, error: HcError) -> JSONResponse:
        return JSONResponse({"error": error.message, "kind": error.kind, "machine": error.machine}, status_code=502)

    @app.exception_handler(BoardError)
    async def board_failed(request: Request, error: BoardError) -> JSONResponse:
        return JSONResponse({"error": str(error), "kind": "board"}, status_code=502)

    def check_target(target: Target) -> None:
        state = store.machines.get(target.machine)
        if state is None or target.address not in state.terminals:
            raise HTTPException(404, f"no terminal {target.machine}/{target.address}")

    # /agents/<machine>/<address> is the same page; its script opens that agent.
    @app.get("/", response_class=HTMLResponse)
    @app.get("/agents/{machine}/{address}", response_class=HTMLResponse)
    def page() -> str:
        return (STATIC / "index.html").read_text()

    @app.get("/static/{name}")
    def static(name: str) -> FileResponse:
        if name not in STATIC_FILES:
            raise HTTPException(404, "not found")
        return FileResponse(STATIC / name, headers={"Cache-Control": "no-cache"})

    # Async like the approval routes, since reading approvals can close expired ones.
    @app.get("/api/agents")
    async def agents() -> dict[str, Any]:
        return {
            "agents": agents_view(store.agents(), approvals=service.approvals.pending_for()),
            "machines": {
                name: {"connected": state.connected, "error": state.error} for name, state in store.machines.items()
            },
        }

    @app.get("/api/screen/{machine}/{address}")
    async def screen(machine: str, address: str) -> dict[str, Any]:
        check_target(Target(machine=machine, address=address))
        result = await remote.hc_json(machine, "read", address, "--lines", "0", timeout=15)
        return {"lines": screen_tail(result.get("text", ""))}

    @app.post("/api/send")
    async def send(body: SendBody) -> dict[str, Any]:
        check_target(body)
        args = ["send", body.address, body.text]
        if body.force:
            args.append("--force")
        return await remote.hc_json(body.machine, *args, timeout=60)

    @app.post("/api/keys")
    async def keys(body: KeysBody) -> dict[str, Any]:
        check_target(body)
        unknown = [key for key in body.keys if key not in ALLOWED_KEYS]
        if unknown:
            raise HTTPException(400, f"keys not allowed: {', '.join(unknown)}")
        return await remote.hc_json(body.machine, "keys", body.address, *body.keys, timeout=15)

    @app.get("/api/projects")
    async def projects() -> list[dict[str, Any]]:
        return await board.projects()

    @app.post("/api/tasks")
    async def add_task(body: TaskBody) -> dict[str, Any]:
        return await board.add_task(body.project_id, body.subproject_id, body.title.strip(), body.notes.strip())

    add_approval_routes(app, service.approvals, store)
    return app
