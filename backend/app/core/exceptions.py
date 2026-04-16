"""Custom exception classes for structured error handling."""


class MiqyasError(Exception):
    """Base exception for all MIQYAS application errors."""

    def __init__(self, message: str = "An unexpected error occurred"):
        self.message = message
        super().__init__(self.message)


class EntityNotFoundError(MiqyasError):
    """Raised when a requested entity does not exist."""

    def __init__(self, entity: str = "Entity", entity_id: str = ""):
        self.entity = entity
        self.entity_id = entity_id
        msg = f"{entity} not found" if not entity_id else f"{entity} '{entity_id}' not found"
        super().__init__(msg)


# ── Procore ────────────────────────────────────────────────────────────


class ProcoreError(MiqyasError):
    """Base exception for Procore integration errors."""


class ProcoreAuthError(ProcoreError):
    """OAuth2 authentication or token refresh failure."""

    def __init__(self, message: str = "Procore authentication failed"):
        super().__init__(message)


class ProcoreAPIError(ProcoreError):
    """Error returned by the Procore REST API."""

    def __init__(
        self,
        message: str = "Procore API request failed",
        status_code: int | None = None,
        response_body: dict | None = None,
    ):
        self.status_code = status_code
        self.response_body = response_body or {}
        detail = message
        if status_code:
            detail = f"{message} (HTTP {status_code})"
        super().__init__(detail)


class ProcoreTokenExpiredError(ProcoreAuthError):
    """Token refresh failed permanently — user must re-authenticate."""

    def __init__(self):
        super().__init__(
            "Procore tokens have expired and could not be refreshed. "
            "Please reconnect your Procore account."
        )


class ProcoreNotConfiguredError(ProcoreError):
    """Procore integration is not configured for this project."""

    def __init__(self, project_id: str = ""):
        msg = "Procore integration is not configured for this project"
        if project_id:
            msg = f"Procore integration is not configured for project '{project_id}'"
        super().__init__(msg)


class ProcoreRateLimitError(ProcoreAPIError):
    """Procore API rate limit exceeded."""

    def __init__(self, retry_after: int | None = None):
        self.retry_after = retry_after
        msg = "Procore API rate limit exceeded"
        if retry_after:
            msg += f" — retry after {retry_after} seconds"
        super().__init__(msg, status_code=429)
