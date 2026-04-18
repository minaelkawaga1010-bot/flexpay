import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .routes import auth, health, wallet

logger = logging.getLogger("flexpay")
logging.basicConfig(level=logging.INFO)


def create_app() -> FastAPI:
    app = FastAPI(
        title="FlexPay API",
        version="0.1.0",
        description="FlexPay — multi-currency wallet, EWA, remittance, credit, Hafiza.",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # restrict in production
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def add_trace_id(request: Request, call_next):
        trace_id = request.headers.get("x-trace-id") or uuid.uuid4().hex
        response = await call_next(request)
        response.headers["x-trace-id"] = trace_id
        return response

    @app.exception_handler(Exception)
    async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled_exception", extra={"path": request.url.path})
        return JSONResponse(
            status_code=500,
            content={
                "type": "https://errors.flexpay.ae/internal",
                "title": "Internal server error",
                "status": 500,
            },
        )

    app.include_router(health.router)
    app.include_router(auth.router, prefix="/v1")
    app.include_router(wallet.router, prefix="/v1")
    return app


app = create_app()
