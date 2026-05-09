import io
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("ADMIN_TOKEN", "test-secret-token")
os.environ.setdefault("ADMIN_USERNAME", "testadmin")
os.environ.setdefault("DB_HOST", "localhost")

from httpx import AsyncClient, ASGITransport
from main import app

BASE = "https://test"

pytestmark = pytest.mark.anyio


def _mock_pool(rows=None):
    rows = rows or []
    mock_cur = AsyncMock()
    mock_cur.__aenter__ = AsyncMock(return_value=mock_cur)
    mock_cur.__aexit__ = AsyncMock(return_value=None)
    mock_cur.fetchall = AsyncMock(return_value=rows)
    mock_cur.fetchone = AsyncMock(return_value=rows[0] if rows else None)
    mock_cur.execute = AsyncMock()
    mock_conn = AsyncMock()
    mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_conn.__aexit__ = AsyncMock(return_value=None)
    mock_conn.cursor = MagicMock(return_value=mock_cur)
    mock_pool = AsyncMock()
    mock_pool.acquire = MagicMock(return_value=mock_conn)
    return mock_pool


@pytest.fixture
def anyio_backend():
    return "asyncio"


# ── Health & root ─────────────────────────────────────────────────────────────

async def test_health():
    async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE) as c:
        r = await c.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


async def test_root():
    async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE) as c:
        r = await c.get("/")
    assert r.status_code == 200
    assert "GeoCore" in r.json()["service"]


# ── Admin login ───────────────────────────────────────────────────────────────

async def test_login_valid():
    async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE) as c:
        r = await c.post("/api/admin/login", json={"username": "testadmin", "token": "test-secret-token"})
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert "gc_admin_token" in r.cookies


async def test_login_wrong_token():
    async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE) as c:
        r = await c.post("/api/admin/login", json={"username": "testadmin", "token": "wrong"})
    assert r.status_code == 401


async def test_login_wrong_user():
    async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE) as c:
        r = await c.post("/api/admin/login", json={"username": "hacker", "token": "test-secret-token"})
    assert r.status_code == 401


async def test_logout():
    async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE) as c:
        r = await c.post("/api/admin/logout")
    assert r.status_code == 200


# ── Admin requests auth ───────────────────────────────────────────────────────

async def test_admin_requests_no_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE) as c:
        r = await c.get("/api/admin/requests")
    assert r.status_code == 401


async def test_admin_requests_wrong_token():
    async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE) as c:
        r = await c.get("/api/admin/requests", headers={
            "Authorization": "Bearer wrong",
            "X-Admin-User": "testadmin",
        })
    assert r.status_code == 401


async def test_admin_requests_bearer_auth():
    with patch("main.get_pool", AsyncMock(return_value=_mock_pool())):
        async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE) as c:
            r = await c.get("/api/admin/requests", headers={
                "Authorization": "Bearer test-secret-token",
                "X-Admin-User": "testadmin",
            })
    assert r.status_code == 200
    assert "requests" in r.json()


async def test_admin_requests_cookie_auth():
    with patch("main.get_pool", AsyncMock(return_value=_mock_pool())):
        async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE) as c:
            await c.post("/api/admin/login", json={"username": "testadmin", "token": "test-secret-token"})
            r = await c.get("/api/admin/requests")
    assert r.status_code == 200


# ── CSV validate ──────────────────────────────────────────────────────────────

VALID_CSV = "HoleID,From,To,Au_gpt\nHDH001,0,1,0.5\nHDH001,1,2,1.5\nHDH001,2,3,0.8\n"


async def test_validate_csv_valid():
    async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE) as c:
        r = await c.post("/api/validate", files={"file": ("test.csv", io.BytesIO(VALID_CSV.encode()), "text/csv")})
    assert r.status_code == 200
    assert r.json()["valid"] is True


async def test_validate_csv_missing_value_column():
    csv = "HoleID,From,To,Notes\nH001,0,1,ok\n"
    async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE) as c:
        r = await c.post("/api/validate", files={"file": ("test.csv", io.BytesIO(csv.encode()), "text/csv")})
    assert r.status_code == 200
    assert r.json()["valid"] is False


async def test_validate_not_csv():
    async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE) as c:
        r = await c.post("/api/validate", files={"file": ("data.xlsx", io.BytesIO(b"data"), "application/octet-stream")})
    assert r.status_code == 400


async def test_validate_csv_too_large():
    big = ("HoleID,From,To,Au_gpt\n" + "H001,0,1,1.0\n" * 1000).encode()
    big = big * 6000  # ~6 MB > 5 MB limit
    async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE) as c:
        r = await c.post("/api/validate", files={"file": ("big.csv", io.BytesIO(big), "text/csv")})
    assert r.status_code == 413


# ── MAC style validation ──────────────────────────────────────────────────────

async def test_mac_invalid_style():
    async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE) as c:
        r = await c.post("/api/mac", data={"composite_length": "2.0", "cutoff": "1.0", "style": "bad_style"},
                         files={"file": ("test.csv", io.BytesIO(VALID_CSV.encode()), "text/csv")})
    assert r.status_code == 400


async def test_mac_valid():
    async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE) as c:
        r = await c.post("/api/mac", data={"composite_length": "2.0", "cutoff": "0.5", "style": "standard"},
                         files={"file": ("test.csv", io.BytesIO(VALID_CSV.encode()), "text/csv")})
    assert r.status_code == 200
    assert "!PRINT" in r.text
    assert "GeoCore" in r.text
