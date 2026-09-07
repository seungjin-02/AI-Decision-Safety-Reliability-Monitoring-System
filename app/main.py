from typing import Annotated
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Depends, Query, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder

from app.db.alert_repository import AlertRepository, PersistenceError
from app.db.connection import init_db
from app.services.evaluation_service import CoreValidationException, evaluate_request
from app.utils.trace import generate_trace_id
from app.schemas import AlertDetailResponse, AlertListResponse, AlertSearchQuery, AlertCursorResponse, EvaluateRequest, EvaluateResponse

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATABASE_PATH = PROJECT_ROOT / "data" / "alert.db"

def get_alert_repository() -> AlertRepository:
    return AlertRepository(DATABASE_PATH)

class AlertNotFoundException(Exception):
    def __init__(self, alert_id: int):
        self.alert_id = alert_id
        super().__init__(f"Alert not found: alert_id={alert_id}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db(DATABASE_PATH)
    yield

app = FastAPI(lifespan=lifespan)

@app.middleware("http")
async def trace_id_middleware(request: Request, call_next):
    trace_id = generate_trace_id()
    request.state.trace_id = trace_id
    response = await call_next(request)
    response.headers["X-Trace-ID"] = trace_id

    return response

@app.exception_handler(RequestValidationError)
async def api_validation_exception_handler(request: Request, exc: RequestValidationError):
    trace_id = request.state.trace_id

    return JSONResponse(
        status_code=422,
        content=jsonable_encoder(
            {
                "trace_id": trace_id,
                "error_type": "api_validation_error",
                "message": "Request format or type is invalid.",
                "details": exc.errors(),
            }
        ),
    )

@app.exception_handler(CoreValidationException)
async def core_validation_exception_handler(request: Request, exc: CoreValidationException):
    trace_id = request.state.trace_id

    return JSONResponse(
        status_code=400,
        content={
            "trace_id": trace_id,
            "error_type": "core_validation_error",
            "message": str(exc),
            "details": [],
        },
    )

@app.exception_handler(PersistenceError)
async def persistence_exception_handler(request: Request, exc: PersistenceError):
    trace_id = request.state.trace_id

    return JSONResponse(
        status_code=500,
        headers={"X-Trace-ID": trace_id},
        content={
            "trace_id": trace_id,
            "error_type": "persistence_error",
            "message": "Failed to persist evaluation result",
            "details": [],
        },
    )

@app.exception_handler(Exception)
async def system_exception_handler(request: Request, exc: Exception):
    trace_id = request.state.trace_id

    return JSONResponse(
        status_code=500,
        headers={"X-Trace-ID": trace_id},
        content={
            "trace_id": trace_id,
            "error_type": "system_error",
            "message": "Unexpected internal server error",
            "details": [],
        },
    )

@app.exception_handler(AlertNotFoundException)
async def alert_not_found_exception_handler(request: Request, exc: AlertNotFoundException):
    trace_id = request.state.trace_id

    return JSONResponse(
        status_code=404,
        headers={"X-Trace-ID": trace_id},
        content={
            "trace_id": trace_id,
            "error_type": "alert_not_found",
            "message": "Alert not found",
            "details": [
                {
                    "alert_id": exc.alert_id,
                }
            ],
        },
    )

@app.post("/evaluate", response_model=EvaluateResponse, status_code=status.HTTP_201_CREATED)
def evaluate_endpoint(payload: EvaluateRequest, request: Request, repository: AlertRepository = Depends(get_alert_repository)):
    trace_id = request.state.trace_id

    return evaluate_request(payload, trace_id, repository)

@app.get("/alerts/{alert_id}", response_model=AlertDetailResponse)
def get_alert_by_id_endpoint(alert_id: int, repository: AlertRepository = Depends(get_alert_repository))  -> AlertDetailResponse:
    detail = repository.find_by_id(alert_id)

    if detail is None:
        raise AlertNotFoundException(alert_id)

    return AlertDetailResponse.model_validate(detail)

@app.get("/alerts", response_model=AlertListResponse)
def get_alerts_endpoint(search_query: Annotated[AlertSearchQuery, Query()], repository: AlertRepository = Depends(get_alert_repository)) -> AlertListResponse:
    requested_limit = search_query.limit

    fetched_details = repository.search(
        limit=requested_limit + 1,
        level=search_query.level,
        human_required=search_query.human_required,
        created_from=search_query.created_from,
        created_to=search_query.created_to,
        cursor_created_at=search_query.cursor_created_at,
        cursor_alert_id=search_query.cursor_alert_id,
    )

    has_next_page = len(fetched_details) > requested_limit
    page_details = fetched_details[:requested_limit] # limit 까지만

    alerts = [AlertDetailResponse.model_validate(detail) for detail in page_details] # model_validate(): 응답 필드가 올바르게 존재하는지 확인

    next_cursor: AlertCursorResponse | None = None

    if has_next_page:
        cursor_source = page_details[-1] # next_cusor 기준

        next_cursor = AlertCursorResponse(
            created_at=cursor_source.created_at,
            alert_id=cursor_source.alert_id,
        )

    return AlertListResponse(
        count=len(alerts),
        limit=requested_limit,
        alerts=alerts,
        next_cursor=next_cursor,
    )