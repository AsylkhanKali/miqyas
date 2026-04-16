"""Tests for the Projects API endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_root(client: AsyncClient):
    resp = await client.get("/")
    assert resp.status_code == 200
    assert resp.json()["service"] == "MIQYAS"


@pytest.mark.asyncio
async def test_health(client: AsyncClient):
    resp = await client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "healthy"


@pytest.mark.asyncio
async def test_create_project(client: AsyncClient):
    payload = {
        "name": "Test Tower Project",
        "code": "TTP-001",
        "description": "A test construction project",
        "location": "Riyadh, KSA",
        "client_name": "Test Client",
    }
    resp = await client.post("/api/v1/projects/", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Test Tower Project"
    assert data["code"] == "TTP-001"
    assert data["status"] == "active"
    assert "id" in data


@pytest.mark.asyncio
async def test_list_projects(client: AsyncClient):
    # Create two projects
    await client.post("/api/v1/projects/", json={"name": "P1", "code": "P1"})
    await client.post("/api/v1/projects/", json={"name": "P2", "code": "P2"})

    resp = await client.get("/api/v1/projects/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    assert len(data["items"]) == 2


@pytest.mark.asyncio
async def test_get_project(client: AsyncClient):
    create_resp = await client.post("/api/v1/projects/", json={"name": "P1", "code": "P1-GET"})
    project_id = create_resp.json()["id"]

    resp = await client.get(f"/api/v1/projects/{project_id}")
    assert resp.status_code == 200
    assert resp.json()["code"] == "P1-GET"


@pytest.mark.asyncio
async def test_get_project_not_found(client: AsyncClient):
    fake_id = "00000000-0000-0000-0000-000000000000"
    resp = await client.get(f"/api/v1/projects/{fake_id}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_project(client: AsyncClient):
    create_resp = await client.post("/api/v1/projects/", json={"name": "P1", "code": "P1-UPD"})
    project_id = create_resp.json()["id"]

    resp = await client.patch(f"/api/v1/projects/{project_id}", json={"name": "Updated Name"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated Name"


@pytest.mark.asyncio
async def test_delete_project(client: AsyncClient):
    create_resp = await client.post("/api/v1/projects/", json={"name": "P1", "code": "P1-DEL"})
    project_id = create_resp.json()["id"]

    resp = await client.delete(f"/api/v1/projects/{project_id}")
    assert resp.status_code == 204

    resp = await client.get(f"/api/v1/projects/{project_id}")
    assert resp.status_code == 404
