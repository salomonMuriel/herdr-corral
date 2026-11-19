from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException

from herdr_pi.jobs import JobBusy
from herdr_pi.ntfy import Push
from herdr_pi.service import Service


def create_app(service: Service) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        service.start()
        yield
        await service.stop()

    app = FastAPI(title="herdr-pi", lifespan=lifespan)
    store = service.store

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "ok": True,
            "version": service.version,
            "machines": {name: state.connected for name, state in store.machines.items()},
        }

    @app.get("/machines")
    def machines() -> dict[str, Any]:
        return store.machine_summary()

    @app.get("/agents")
    def agents(machine: str | None = None) -> list[dict[str, Any]]:
        check_machine(machine)
        return store.agents(machine)

    @app.get("/terminals")
    def terminals(machine: str | None = None) -> list[dict[str, Any]]:
        check_machine(machine)
        return store.terminals(machine)

    @app.get("/jobs")
    def jobs() -> list[dict[str, Any]]:
        return service.runner.summary()

    @app.post("/jobs/{name}/run")
    async def run_job(name: str) -> dict[str, Any]:
        job = service.runner.jobs.get(name)
        if job is None:
            raise HTTPException(404, f"no job named {name}")
        try:
            await service.runner.run_now(name)
        except JobBusy:
            raise HTTPException(409, f"{name} is already running")
        return job.summary()

    @app.get("/alerts")
    def alerts() -> dict[str, Any]:
        return service.alerts.summary()

    @app.post("/alerts/test")
    async def test_alert() -> dict[str, Any]:
        url = service.settings.alerts.agent_url.format(machine=service.settings.machines[0].name, address="t1")
        await service.alerts.publish(Push("Herdr", "Test alert from herdr-pi", url, ["bell"]))
        return service.alerts.summary()

    def check_machine(machine: str | None) -> None:
        if machine is not None and machine not in store.machines:
            raise HTTPException(404, f"no machine named {machine}")

    return app
