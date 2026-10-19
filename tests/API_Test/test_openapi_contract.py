import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas import ErrorResponse


client = TestClient(app)


@pytest.mark.parametrize(
    "path, method, error_statuses",
    [
        ("/evaluate", "post", [400, 422, 500]),
        ("/alerts/{alert_id}", "get", [404, 422, 500]),
        ("/alerts", "get", [422, 500]),
    ],
)
def test_openapi_documents_custom_error_responses(path, method, error_statuses):
    schema = client.get("/openapi.json").json()
    responses = schema["paths"][path][method]["responses"]

    for status_code in error_statuses:
        response_schema = responses[str(status_code)]["content"]["application/json"]["schema"]
        assert response_schema == {"$ref": "#/components/schemas/ErrorResponse"}

    error_schema = schema["components"]["schemas"]["ErrorResponse"]
    assert set(error_schema["properties"]) == {"trace_id", "error_type", "message", "details"}
    assert error_schema["properties"]["details"]["type"] == "array"


@pytest.mark.parametrize(
    "method, path, kwargs, schema_path",
    [
        ("post", "/evaluate", {"json": {}}, "/evaluate"),
        ("get", "/alerts?limit=0", {}, "/alerts"),
        ("get", "/alerts/not-an-integer", {}, "/alerts/{alert_id}"),
    ],
)
def test_actual_validation_error_matches_published_model(method, path, kwargs, schema_path):
    response = client.request(method, path, **kwargs)
    schema = client.get("/openapi.json").json()

    published_schema = schema["paths"][schema_path][method]["responses"]["422"]["content"]["application/json"]["schema"]
    assert published_schema == {"$ref": "#/components/schemas/ErrorResponse"}
    assert response.status_code == 422

    body = response.json()
    error = ErrorResponse.model_validate(body)
    assert set(body) == set(schema["components"]["schemas"]["ErrorResponse"]["properties"])
    assert error.error_type == "api_validation_error"
    assert error.trace_id == response.headers["x-trace-id"]
    assert error.details
