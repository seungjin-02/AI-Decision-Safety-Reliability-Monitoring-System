import sqlite3
from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name("schema.sql")
CURRENT_SCHEMA_VERSION = 1

def create_connection(db_path: str | Path) -> sqlite3.Connection:
    connection = sqlite3.connect(db_path)
    connection.execute("PRAGMA foreign_keys=ON")
    connection.row_factory = sqlite3.Row

    return connection

def validate_unversioned_schema(connection: sqlite3.Connection, schema_sql: str) -> None:
    reference_connection = create_connection(":memory:")

    try:
        reference_connection.executescript(schema_sql)

        schema_query = """
            SELECT type, name, tbl_name, sql
            FROM sqlite_master
            WHERE name NOT GLOB 'sqlite_*'
            ORDER BY type, name
        """

        expected_rows = reference_connection.execute(schema_query).fetchall()
        actual_rows = connection.execute(schema_query).fetchall()

        expected_schema = [tuple(row) for row in expected_rows]
        actual_schema = [tuple(row) for row in actual_rows]

        if actual_schema != expected_schema:
            raise RuntimeError(
                "Unversioned database contains existing tables. "
                "Schema does not match the supported definition."
            )

    finally:
        reference_connection.close()

def init_db(db_path: str | Path) -> None:
    connection = create_connection(db_path)

    try:
        version_row = connection.execute("PRAGMA user_version").fetchone() # DB에 기록된 버전 조회 후 가져오기

        current_version = version_row[0]

        if current_version == CURRENT_SCHEMA_VERSION:
            return

        if current_version != 0:
            raise RuntimeError(
                f"Unsupported database schema version: {current_version}. "
                f"Expected: {CURRENT_SCHEMA_VERSION}."
            )

        existing_table = connection.execute(
            """
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name NOT GLOB 'sqlite_*'
            LIMIT 1
            """
        ).fetchone()

        schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
        if existing_table is not None:
            # 기존 DB: 구조 확인과 버전 기록을 하나로 묶음
            connection.execute("BEGIN;")
            validate_unversioned_schema(connection, schema_sql)
        else:
            # 새 DB: 테이블 생성부터 진행
            connection.executescript("BEGIN;\n" + schema_sql)

        connection.execute(f"PRAGMA user_version = {CURRENT_SCHEMA_VERSION}")

        connection.commit()

    except (sqlite3.Error, RuntimeError):
        connection.rollback()
        raise

    finally:
        connection.close()