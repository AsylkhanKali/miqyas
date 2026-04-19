FROM python:3.12-slim

# System dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install API-only dependencies (без torch/transformers — ~200MB вместо 6GB)
COPY requirements-api.txt .
RUN pip install --no-cache-dir -r requirements-api.txt

# Copy app code
COPY . .

# Create uploads directory
RUN mkdir -p uploads/ifc uploads/video uploads/frames uploads/reports

EXPOSE 8000

CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
