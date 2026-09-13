import sqlite3
import pytest

from core.main import evaluate_event
from core.step01_DecisionEvent import DecisionEvent

from app.db.connection import SCHEMA_PATH, create_connection, init_db

def test_init_db_create_all_tables(tmp_path):
    db_path = tmp_path / 'test.db'
    init_db(db_path)
    connection = create_connection(db_path)

    try:
        rows = connection.execute(
            """
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
                AND name IN ('alerts', 'alert_signals', 'alert_actions')
            """
        ).fetchall()

        table_names = {row["name"] for row in rows}

        assert table_names == {
            "alerts",
            "alert_signals",
            "alert_actions",
        }

        version_row = connection.execute("PRAGMA user_version").fetchone()

        assert version_row[0] == 1

    finally:
        connection.close()

def test_init_db_rejects_future_schema_version(tmp_path):
    db_path = tmp_path / "future.db"
    connection = create_connection(db_path)

    try:
        connection.execute("PRAGMA user_version = 2") # 현재 user_version = 1
        connection.commit()

    finally:
        connection.close()

    with pytest.raises(
        RuntimeError,
        match="Unsupported database schema version: 2",
    ):
        init_db(db_path)

    connection = create_connection(db_path)

    try:
        version_row = connection.execute("PRAGMA user_version").fetchone()

        assert version_row[0] == 2

        rows = connection.execute(
            """
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name IN (
                  'alerts',
                  'alert_signals',
                  'alert_actions'
              )
            """
        ).fetchall()

        table_names = {row["name"] for row in rows}

        assert table_names == set()

    finally:
        connection.close()

def test_init_db_rejects_unversioned_existing_database(tmp_path):
    db_path = tmp_path / "legacy.db"
    connection = create_connection(db_path)

    try:
        connection.execute(
            """
            CREATE TABLE alerts (
                alert_id INTEGER PRIMARY KEY,
                event_id TEXT NOT NULL
            )
            """
        )

        connection.execute(
            """
            INSERT INTO alerts (alert_id, event_id)
            VALUES (?, ?)
            """,
            (1, "event_legacy"),
        )

        connection.commit()

    finally:
        connection.close()

    # 버전이 없고 테이블과 값이 존재하는 db 확인
    with pytest.raises(
        RuntimeError,
        match="Unversioned database contains existing tables",
    ):
        init_db(db_path)

    connection = create_connection(db_path)

    try:
        version_row = connection.execute("PRAGMA user_version").fetchone()

        assert version_row[0] == 0

        rows = connection.execute(
            """
            SELECT alert_id, event_id
            FROM alerts
            ORDER BY alert_id
            """
        ).fetchall()

        saved_values = [(row["alert_id"], row["event_id"]) for row in rows]

        assert saved_values == [(1, "event_legacy")]

        table_rows = connection.execute(
            """
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name NOT GLOB 'sqlite_*'
            """
        ).fetchall()

        table_names = {row["name"] for row in table_rows}

        assert table_names == {"alerts"}

    finally:
        connection.close()

def test_init_db_rollback_all_tables_on_schema_error(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    broken_schema_path = tmp_path / "broken_schema.sql"

    broken_schema_path.write_text(
        """
        CREATE TABLE alerts (
            alert_id INTEGER PRIMARY KEY
        );

        CREATE TABL alert_signals (
            signal_id INTEGER PRIMARY KEY
        );
        """,
        encoding="utf-8",
    )

    # SCHEMA_PATH를 찾아서 테스트 중에만 broken_schema_path로 교체
    monkeypatch.setattr(
        "app.db.connection.SCHEMA_PATH",
        broken_schema_path,
    )

    with pytest.raises(sqlite3.OperationalError):
        init_db(db_path)

    # rollback 결과를 확인하기 위한 connection
    connection = create_connection(db_path)

    try:
        rows = connection.execute(
            """
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name IN ('alerts', 'alert_signals')
            """
        ).fetchall()

        table_names = {row["name"] for row in rows}

        assert table_names == set()

    finally:
        connection.close()

def test_init_db_preserves_existing_alert_on_repeated_call(repository, test_db_path):
    event = DecisionEvent(
        event_id="event_repeated_init",
        decision_type="approve",
        confidence=0.3,
        latency_ms=800,
        model_version="v1",
        error_code=None,
        metadata={
            "source": "repeated_init_test",
        },
    )

    alert = evaluate_event(event)

    saved = repository.save(
        alert=alert,
        trace_id="trace_repeated_init",
    )

    before = repository.find_by_id(
        alert_id=saved.alert_id,
    )

    assert before is not None
    assert len(before.signals) > 0
    assert len(before.recommended_actions) > 0

    # fixture에서 한 번 초기화한 DB를 다시 초기화
    init_db(test_db_path)

    after = repository.find_by_id(
        alert_id=saved.alert_id,
    )

    assert after is not None
    assert after == before

    connection = create_connection(test_db_path)

    try:
        version_row = connection.execute("PRAGMA user_version").fetchone()

        assert version_row[0] == 1

    finally:
        connection.close()

def test_init_db_registers_compatible_unversioned_database(repository, test_db_path):
    event = DecisionEvent(
        event_id="event_register_schema",
        decision_type="approve",
        confidence=0.3,
        latency_ms=800,
        model_version="v1",
        error_code=None,
        metadata={
            "source": "register_schema_test",
        },
    )

    alert = evaluate_event(event)

    saved = repository.save(
        alert=alert,
        trace_id="trace_register_schema",
    )

    before = repository.find_by_id(
        alert_id=saved.alert_id,
    )

    assert before is not None
    assert len(before.signals) > 0
    assert len(before.recommended_actions) > 0

    connection = create_connection(test_db_path)

    try:
        connection.execute("PRAGMA user_version = 0")
        connection.commit()

    finally:
        connection.close()

    init_db(test_db_path)

    after = repository.find_by_id(
        alert_id=saved.alert_id,
    )

    assert after is not None
    assert after == before

    connection = create_connection(test_db_path)

    try:
        version_row = connection.execute("PRAGMA user_version").fetchone()

        assert version_row[0] == 1

    finally:
        connection.close()

def test_init_db_rejects_unversioned_schema_missing_check(tmp_path):
    db_path = tmp_path / "missing_check.db"

    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")

    check_clause = "CHECK (risk_score >= 0)"

    # 테스트에서 제거하려는 제약조건이 실제로 있는지 확인
    assert schema_sql.count(check_clause) == 1

    modified_schema = schema_sql.replace(check_clause, "", 1) # check_caluse를 빈 문자열로 한번 교체

    connection = create_connection(db_path)

    try:
        # 테이블과 컬럼은 같지만 CHECK 하나가 빠진 DB 준비
        connection.executescript(modified_schema)
        connection.commit()

        before_row = connection.execute(
            """
            SELECT sql
            FROM sqlite_master
            WHERE type = 'table'
              AND name = 'alerts'
            """
        ).fetchone()

        before_sql = before_row["sql"]

    finally:
        connection.close()

    with pytest.raises(
        RuntimeError,
        match="Schema does not match the supported definition",
    ):
        init_db(db_path)

    connection = create_connection(db_path)

    try:
        version_row = connection.execute("PRAGMA user_version").fetchone()

        assert version_row[0] == 0 #이전 버전 schema 거부 이후 버전이 0으로 유지되는지 확인

        after_row = connection.execute(
            """
            SELECT sql
            FROM sqlite_master
            WHERE type = 'table'
              AND name = 'alerts'
            """
        ).fetchone()

        assert after_row is not None
        assert after_row["sql"] == before_sql

    finally:
        connection.close()

def test_create_connection_enables_foreign_keys(test_db_path):
    connection = create_connection(test_db_path)

    try:
        row = connection.execute("PRAGMA foreign_keys").fetchone()
        assert row[0] == 1

    finally:
        connection.close()

def test_create_connection_uses_row_factory(test_db_path):
    connection = create_connection(test_db_path)

    try:
        row = connection.execute(
            "SELECT 123 AS test_value"
        ).fetchone()

        assert isinstance(row, sqlite3.Row)
        assert row["test_value"] == 123

    finally:
        connection.close()

def test_foreign_key_rejects_signal_without_alert(test_db_path):
    connection = create_connection(test_db_path)

    try:
        with pytest.raises(
            sqlite3.IntegrityError,
            match="FOREIGN KEY constraint failed",
        ):
            connection.execute(
                """
                INSERT INTO alert_signals (
                    alert_id,
                    rule_id,
                    category,
                    score,
                    reason,
                    evidence,
                    is_critical_override,
                    metadata
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    999999,
                    "test-rule-001",
                    "risk",
                    5,
                    "pytest test",
                    "{}",
                    0,
                    "{}",
                ),
            )

        row = connection.execute(
            "SELECT COUNT(*) AS count FROM alert_signals"
        ).fetchone()

        assert row["count"] == 0
    finally:
        connection.rollback()
        connection.close()