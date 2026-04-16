"""Gunicorn configuration for MIQYAS production deployment."""

import multiprocessing
import os

# Server socket
bind = "0.0.0.0:8000"

# Worker processes
workers = int(os.getenv("GUNICORN_WORKERS", min(multiprocessing.cpu_count() * 2 + 1, 8)))
worker_class = "uvicorn.workers.UvicornWorker"
worker_tmp_dir = "/dev/shm"

# Timeouts
timeout = 120
graceful_timeout = 30
keepalive = 5

# Logging
accesslog = "-"
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info")
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)sμs'

# Process naming
proc_name = "miqyas"

# Limits
max_requests = 1000
max_requests_jitter = 50
limit_request_line = 8190
