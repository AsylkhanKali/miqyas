"""
Structured logging configuration using structlog.

Call `setup_logging()` at app startup to switch from stdlib logging
to structured JSON logs in production, or colored console logs in dev.
"""

import logging
import sys

import structlog


def setup_logging(json_logs: bool = False, log_level: str = "INFO") -> None:
    """Configure structlog + stdlib logging integration.

    Args:
        json_logs: True for JSON output (production), False for colored console (dev).
        log_level: Root log level (DEBUG, INFO, WARNING, ERROR).
    """
    shared_processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.UnicodeDecoder(),
    ]

    if json_logs:
        # Production: JSON to stdout
        renderer = structlog.processors.JSONRenderer()
    else:
        # Dev: colored console output
        renderer = structlog.dev.ConsoleRenderer()

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
        foreign_pre_chain=shared_processors,
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(getattr(logging, log_level.upper(), logging.INFO))

    # Quiet noisy libraries
    for name in ("uvicorn.access", "sqlalchemy.engine", "celery.worker.strategy"):
        logging.getLogger(name).setLevel(logging.WARNING)
