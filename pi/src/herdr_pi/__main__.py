import asyncio
import logging

import uvicorn

from herdr_pi.api import create_app
from herdr_pi.config import load_settings, read_version
from herdr_pi.service import build_service
from herdr_pi.web import create_web_app


async def serve() -> None:
    settings = load_settings()
    service = build_service(settings, read_version())
    api = uvicorn.Server(uvicorn.Config(create_app(service), host=settings.host, port=settings.port))
    web_app = create_web_app(service, service.board)
    web = uvicorn.Server(uvicorn.Config(web_app, host=settings.host, port=settings.web_port, lifespan="off"))
    servers = [api, web]

    # Each server installs its own signal handler and the last one wins, so either stops both.
    def stop_all(*_: object) -> None:
        for server in servers:
            server.should_exit = True

    for server in servers:
        server.handle_exit = stop_all  # type: ignore[method-assign]
    await asyncio.gather(*(server.serve() for server in servers))


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    asyncio.run(serve())


if __name__ == "__main__":
    main()
