from fastapi.testclient import TestClient
import app.main as main


def test_missing_dist_preserves_import_startup_and_api(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DASHBOARD_PATH", tmp_path / "absent-dist")
    monkeypatch.setattr(main, "DATABASE_PATH", tmp_path / "startup.db")
    with TestClient(main.app) as client:
        dashboard = client.get("/dashboard/")
        assert dashboard.status_code == 503
        assert "대시보드가 준비되지 않았습니다." in dashboard.text
        assert client.get("/alerts").status_code == 200
        assert client.get("/alerts").json()["alerts"] == []
        assert client.get("/docs").status_code == 200


def test_static_scope_is_dist_only_and_api_routes_remain_available(tmp_path, monkeypatch):
    dist = tmp_path / "frontend" / "dist"
    dist.mkdir(parents=True)
    (dist / "index.html").write_text('<div id="dashboard-test">dashboard</div>', encoding="utf-8")
    (dist / "app.js").write_text("export const ready = true;", encoding="utf-8")
    (dist.parent / "private.txt").write_text("outside dist", encoding="utf-8")
    monkeypatch.setattr(main, "DASHBOARD_PATH", dist)
    monkeypatch.setattr(main, "DATABASE_PATH", tmp_path / "static.db")
    with TestClient(main.app) as client:
        assert client.get("/dashboard/").status_code == 200
        assert client.get("/dashboard/app.js").text == "export const ready = true;"
        for path in ["src/app.js", "data/alerts.db", "../private.txt", "%2e%2e/private.txt"]:
            response = client.get("/dashboard/" + path)
            assert response.status_code == 404
            assert "outside dist" not in response.text
        assert client.get("/docs").status_code == 200
        assert client.get("/alerts").json()["limit"] == 5
        assert client.get("/alerts/9999").status_code == 404


def test_built_runtime_is_served_over_http(test_db_path):
    # The frontend build is a prerequisite for this generated-artifact check.
    dist = main.DASHBOARD_PATH
    if not (dist / "index.html").is_file():
        import pytest
        pytest.skip("Run python frontend/build_web.py for generated runtime verification")
    client = TestClient(main.app)
    assert client.get("/dashboard/").status_code == 200
    for name in ["app.js", "entry.js", "api-adapter.js", "mock-adapter.js", "display-contract.js", "styles.css"]:
        response = client.get("/dashboard/" + name)
        assert response.status_code == 200
        assert response.content == (dist / name).read_bytes()
