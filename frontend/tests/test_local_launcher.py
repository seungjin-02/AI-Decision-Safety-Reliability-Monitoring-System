"""Verify the single launcher preserves DB selection and refuses unsafe defaults."""
import sqlite3
import sys

import pytest

import c2_dashboard_local as launcher
import app.main as application
import frontend.build_web as builder
import uvicorn


@pytest.fixture
def setup_launcher(tmp_path, monkeypatch):
    monkeypatch.setattr(launcher, 'ROOT', tmp_path)
    monkeypatch.setattr(application, 'DATABASE_PATH', tmp_path / 'data/alerts.db')
    builds, runs = [], []
    monkeypatch.setattr(builder, 'build', lambda path: builds.append(path))
    monkeypatch.setattr(uvicorn, 'run', lambda app, **kwargs: runs.append((app, kwargs)))
    class AvailableSocket:
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def bind(self, address):
            pass
    monkeypatch.setattr(launcher.socket, 'socket', AvailableSocket)
    return tmp_path, builds, runs


def test_no_arguments_builds_and_runs_with_existing_demo(setup_launcher, monkeypatch, capsys):
    root, builds, runs = setup_launcher
    database = root / 'data/c2-demo.db'
    database.parent.mkdir()
    with sqlite3.connect(database) as connection:
        connection.execute('CREATE TABLE alerts (alert_id INTEGER)')
        connection.executemany('INSERT INTO alerts VALUES (?)', [(1,), (2,)])
    before = database.read_bytes()
    monkeypatch.setattr(sys, 'argv', ['c2_dashboard_local.py'])
    launcher.main()
    assert application.DATABASE_PATH == database.resolve()
    assert builds == [root / 'frontend']
    assert runs == [(application.app, {'host': '127.0.0.1', 'port': 8000})]
    assert database.read_bytes() == before
    output = capsys.readouterr().out
    assert 'DEMO_ROWS=2' in output
    assert 'http://127.0.0.1:8000/dashboard/' in output


def test_missing_default_is_not_silently_created(setup_launcher, monkeypatch):
    root, builds, runs = setup_launcher
    monkeypatch.setattr(sys, 'argv', ['c2_dashboard_local.py'])
    with pytest.raises(SystemExit) as error:
        launcher.main()
    assert error.value.code == 2
    assert not (root / 'data/c2-demo.db').exists()
    assert builds == runs == []


def test_user_database_is_refused_and_preserved(setup_launcher, monkeypatch):
    root, builds, runs = setup_launcher
    database = root / 'data/alerts.db'
    database.parent.mkdir()
    database.write_bytes(b'preserve user data')
    monkeypatch.setattr(sys, 'argv', ['c2_dashboard_local.py', '--db', str(database)])
    with pytest.raises(SystemExit):
        launcher.main()
    assert database.read_bytes() == b'preserve user data'
    assert builds == runs == []


def test_explicit_new_isolated_database_is_passed_to_app(setup_launcher, monkeypatch):
    root, builds, runs = setup_launcher
    database = root / 'new-demo/alerts.db'
    monkeypatch.setattr(sys, 'argv', ['c2_dashboard_local.py', '--db', str(database), '--port', '8002'])
    launcher.main()
    assert application.DATABASE_PATH == database.resolve()
    assert builds == [root / 'frontend']
    assert runs[0][1]['port'] == 8002
    assert database.parent.is_dir()
    assert not database.exists()  # Only the real FastAPI lifespan initializes the DB.


def test_invalid_existing_database_is_not_replaced(setup_launcher, monkeypatch):
    root, builds, runs = setup_launcher
    database = root / 'invalid.db'
    database.write_bytes(b'not sqlite')
    monkeypatch.setattr(sys, 'argv', ['c2_dashboard_local.py', '--db', str(database)])
    with pytest.raises(SystemExit):
        launcher.main()
    assert database.read_bytes() == b'not sqlite'
    assert builds == runs == []


def test_occupied_port_does_not_start_app_or_create_db(setup_launcher, monkeypatch):
    root, builds, runs = setup_launcher
    def unavailable_socket():
        raise OSError('in use')
    monkeypatch.setattr(launcher.socket, 'socket', unavailable_socket)
    database = root / 'new.db'
    monkeypatch.setattr(sys, 'argv', ['c2_dashboard_local.py', '--db', str(database)])
    with pytest.raises(SystemExit):
        launcher.main()
    assert not database.exists()
    assert builds == runs == []
