"""The board's SQL over HTTP, in the request and response shapes of Neon's /sql endpoint.

Run with `python -m herdr_pi.sql_gateway`. Clients send the connection string in
`Neon-Connection-String`; its password must match the database's.
"""

import asyncio
import hmac
import json
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import psycopg
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from psycopg.rows import dict_row
from psycopg.types.string import TextLoader
from psycopg_pool import AsyncConnectionPool
from pydantic import BaseModel

log = logging.getLogger(__name__)

# Neon returns these as Postgres prints them; the rest come back as JSON numbers, booleans,
# parsed json and lists.
TEXT_TYPES = [
    "int8", "numeric", "date", "time", "timetz", "timestamp", "timestamptz", "interval",
    "uuid", "inet", "cidr", "money", "bytea", "oid", "record",
]


class Statement(BaseModel):
    query: str
    params: list[Any] = []


class Batch(BaseModel):
    queries: list[Statement]


class GatewayError(Exception):
    def __init__(self, status: int, message: str, code: str | None = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code


def serialize(value: Any) -> str | None:
    """Params reach Postgres as untyped text, as Neon sends them, so Postgres infers each type."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    return str(value)


def password_of(conninfo: str) -> str:
    try:
        return conninfo_to_dict(conninfo).get("password") or ""
    except psycopg.ProgrammingError:
        return ""


async def configure(connection: psycopg.AsyncConnection[Any]) -> None:
    for name in TEXT_TYPES:
        connection.adapters.register_loader(name, TextLoader)
    await connection.set_autocommit(True)


async def run(connection: psycopg.AsyncConnection[Any], statement: Statement) -> list[dict[str, Any]]:
    async with psycopg.AsyncRawCursor(connection, row_factory=dict_row) as cursor:
        await cursor.execute(statement.query, [serialize(value) for value in statement.params])
        return await cursor.fetchall() if cursor.description else []


class Gateway:
    def __init__(self, conninfo: str):
        self.password = password_of(conninfo)
        # No server-side prepared statements, so transaction poolers (PgBouncer, Supavisor) work.
        self.pool = AsyncConnectionPool(conninfo, min_size=1, max_size=4, configure=configure, open=False,
                                        kwargs={"prepare_threshold": None})

    def authorize(self, header: str | None) -> None:
        given = password_of(header or "")
        if not self.password or not hmac.compare_digest(given.encode(), self.password.encode()):
            raise GatewayError(401, "wrong or missing Neon-Connection-String")

    async def single(self, statement: Statement) -> dict[str, Any]:
        async with self.pool.connection() as connection:
            return {"rows": await run(connection, statement)}

    async def batch(self, batch: Batch) -> dict[str, Any]:
        async with self.pool.connection() as connection:
            async with connection.transaction():
                return {"results": [{"rows": await run(connection, statement)} for statement in batch.queries]}

    async def health(self) -> dict[str, Any]:
        async with self.pool.connection() as connection:
            row = await (await connection.execute("select pg_is_in_recovery()")).fetchone()
        return {"ok": True, "standby": bool(row and row[0])}


def parse(body: Any) -> Statement | Batch:
    if isinstance(body, dict) and "queries" in body:
        return Batch.model_validate(body)
    return Statement.model_validate(body)


def create_gateway_app(gateway: Gateway) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await gateway.pool.open()
        yield
        await gateway.pool.close()

    app = FastAPI(lifespan=lifespan)

    @app.exception_handler(GatewayError)
    async def gateway_error(_: Request, error: GatewayError) -> JSONResponse:
        return JSONResponse({"message": error.message, "code": error.code}, status_code=error.status)

    @app.post("/sql")
    async def sql(request: Request) -> dict[str, Any]:
        gateway.authorize(request.headers.get("Neon-Connection-String"))
        try:
            body = parse(await request.json())
        except ValueError as error:
            raise GatewayError(400, f"bad request: {error}") from error
        try:
            if isinstance(body, Batch):
                return await gateway.batch(body)
            return await gateway.single(body)
        except psycopg.Error as error:
            message = error.diag.message_primary or str(error)
            raise GatewayError(400, message, error.sqlstate) from error

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return await gateway.health()

    return app


def conninfo_from_env() -> str:
    """HERDR_DATABASE_URL for any Postgres; otherwise the Pi's own herdr-db."""
    if os.environ.get("HERDR_DATABASE_URL"):
        return os.environ["HERDR_DATABASE_URL"]
    return make_conninfo(
        host=os.environ.get("HERDR_DB_HOST", "127.0.0.1"),
        port=os.environ.get("HERDR_DB_PORT", "5440"),
        user=os.environ.get("POSTGRES_USER", "herdr"),
        dbname=os.environ.get("POSTGRES_DB", "herdr"),
        password=os.environ["POSTGRES_PASSWORD"],
    )


async def serve() -> None:
    port = int(os.environ.get("HERDR_SQL_PORT", "8097"))
    app = create_gateway_app(Gateway(conninfo_from_env()))
    host = os.environ.get("HERDR_SQL_BIND", "127.0.0.1")
    await uvicorn.Server(uvicorn.Config(app, host=host, port=port)).serve()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    asyncio.run(serve())
