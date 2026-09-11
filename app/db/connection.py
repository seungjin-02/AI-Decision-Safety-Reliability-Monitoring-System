import sqlite3
from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name("schema.sql")
CURRENT_SCHEMA_VERSION = 1

def create_connection(db_path: str | Path) -> sqlite3.Connection:
    connection = sqlite3.connect(db_path)
    connection.execute("PRAGMA foreign_keys=ON")
    connection.row_factory = sqlite3.Row

    return connection

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

        if existing_table is not None:
            raise RuntimeError(
                "Unversioned database contains existing tables. "
                "Schema verification is required."
            )

        schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
        connection.executescript("BEGIN;\n" + schema_sql)
        connection.execute(f"PRAGMA user_version = {CURRENT_SCHEMA_VERSION}")

        connection.commit()

    except sqlite3.Error:
        connection.rollback()
        raise

    finally:
        connection.close()