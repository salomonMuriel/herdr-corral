import os
from collections.abc import AsyncIterator

import httpx
import pytest

from herdr_pi.sql_gateway import Gateway, create_gateway_app, serialize

# A disposable Postgres, e.g. `docker run --rm -e POSTGRES_PASSWORD=testpw -e POSTGRES_USER=herdr
# -e POSTGRES_DB=herdr -p 127.0.0.1:55440:5432 postgres:18 -c timezone=UTC`.
DSN = os.environ.get("HERDR_SQL_TEST_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="HERDR_SQL_TEST_DSN is not set")

AUTH = {"Neon-Connection-String": "postgresql://herdr:testpw@pi.example/herdr"}


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    assert DSN
    gateway = Gateway(DSN)
    await gateway.pool.open()
    transport = httpx.ASGITransport(app=create_gateway_app(gateway))
    async with httpx.AsyncClient(transport=transport, base_url="http://gateway") as http:
        await http.post("/sql", headers=AUTH, json={"query": "drop table if exists gateway_test"})
        await http.post("/sql", headers=AUTH, json={"query": "create table gateway_test (id int primary key, name text)"})
        yield http
    await gateway.pool.close()


def test_params_are_sent_as_text() -> None:
    assert [serialize(v) for v in [None, True, 3, "a", {"k": 1}, [1]]] == [None, "true", "3", "a", '{"k": 1}', "[1]"]


async def test_values_come_back_as_neon_returns_them(client: httpx.AsyncClient) -> None:
    query = (
        "select 1::int a, true b, '{\"x\":[1]}'::jsonb j, '2026-11-10 03:36:49.739961+00'::timestamptz t,"
        " array[1,2] arr, 1.5::numeric n, 46::bigint c, null::text z, interval '3 hours' i,"
        " 5::oid o, row(1, 'a') r, '{1,2}'::bigint[] ba, 1.5::float8 f"
    )
    response = await client.post("/sql", headers=AUTH, json={"query": query})
    assert response.json() == {"rows": [{
        "a": 1, "b": True, "j": {"x": [1]}, "t": "2026-11-10 03:36:49.739961+00",
        "arr": [1, 2], "n": "1.5", "c": "46", "z": None, "i": "03:00:00",
        "o": "5", "r": "(1,a)", "ba": ["1", "2"], "f": 1.5,
    }]}


async def test_untyped_params_take_their_column_types(client: httpx.AsyncClient) -> None:
    await client.post("/sql", headers=AUTH, json={"query": "insert into gateway_test values ($1, $2)", "params": ["7", "seven"]})
    response = await client.post("/sql", headers=AUTH, json={"query": "select name from gateway_test where id = $1 + 0", "params": [7]})
    assert response.json() == {"rows": [{"name": "seven"}]}


async def test_a_batch_runs_in_one_transaction(client: httpx.AsyncClient) -> None:
    batch = {"queries": [
        {"query": "select set_config('herdr.actor', $1, true)", "params": ["person"]},
        {"query": "insert into gateway_test values (1, current_setting('herdr.actor')) returning name"},
    ]}
    response = await client.post("/sql", headers=AUTH, json=batch)
    assert response.json() == {"results": [{"rows": [{"set_config": "person"}]}, {"rows": [{"name": "person"}]}]}


async def test_a_failing_batch_rolls_back(client: httpx.AsyncClient) -> None:
    batch = {"queries": [
        {"query": "insert into gateway_test values (2, 'kept?')"},
        {"query": "insert into gateway_test values (2, 'duplicate')"},
    ]}
    response = await client.post("/sql", headers=AUTH, json=batch)
    assert response.status_code == 400
    assert "duplicate key" in response.json()["message"]
    rows = await client.post("/sql", headers=AUTH, json={"query": "select count(*)::int n from gateway_test"})
    assert rows.json() == {"rows": [{"n": 0}]}


async def test_statements_without_rows_return_none(client: httpx.AsyncClient) -> None:
    response = await client.post("/sql", headers=AUTH, json={"query": "update gateway_test set name = 'x'"})
    assert response.json() == {"rows": []}


async def test_wrong_password_is_refused(client: httpx.AsyncClient) -> None:
    wrong = {"Neon-Connection-String": "postgresql://herdr:nope@pi.example/herdr"}
    assert (await client.post("/sql", headers=wrong, json={"query": "select 1"})).status_code == 401
    assert (await client.post("/sql", json={"query": "select 1"})).status_code == 401


async def test_health_says_whether_it_is_a_standby(client: httpx.AsyncClient) -> None:
    assert (await client.get("/health")).json() == {"ok": True, "standby": False}
