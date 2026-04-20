FROM python:3.12-slim

RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements-api.txt .

# Install the heaviest packages first in a separate layer so Docker
# caches them independently — avoids re-downloading on every code change.
RUN pip install --no-cache-dir --timeout 120 --retries 5 \
    ifcopenshell==0.8.1 \
    "scipy>=1.12.0" \
    "boto3>=1.34.0"

# Install remaining dependencies
RUN pip install --no-cache-dir --timeout 120 --retries 5 -r requirements-api.txt

COPY . .

RUN mkdir -p uploads/ifc uploads/video uploads/frames uploads/reports

EXPOSE 8000

CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
