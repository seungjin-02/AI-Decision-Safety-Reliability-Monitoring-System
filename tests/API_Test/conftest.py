import logging
import pytest

from app.utils.structured_logging import request_logger
from app.db.alert_repository import AlertRepository
from app.db.connection import init_db
from app.main import app, get_alert_repository

@pytest.fixture
def test_db_path(tmp_path):
    db_path = tmp_path / "api_test.db"
    init_db(db_path)

    def override_repository():
        return AlertRepository(db_path)

    # get_alert_repository -> override_repository() -> AlertRepository(dp_path)
    app.dependency_overrides[get_alert_repository] = override_repository

    yield db_path # 여기서 fixture 일시 정지

    # 테스트가 끝난 후 실행
    app.dependency_overrides.pop(get_alert_repository, None)

@pytest.fixture
def request_log_records():
    records: list[logging.LogRecord] = []

    class CollectingHandler(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    handler = CollectingHandler()
    request_logger.addHandler(handler)

    try:
        yield records

    finally:
        request_logger.removeHandler(handler)
        handler.close()