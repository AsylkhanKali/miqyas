FROM python:3.12-slim

# System dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all dependencies (API + Worker)
COPY requirements-api.txt requirements-worker.txt ./
RUN pip install --no-cache-dir --timeout=300 -r requirements-api.txt -r requirements-worker.txt

# Copy app code
COPY . .

# Create uploads directory
RUN mkdir -p uploads/ifc uploads/video uploads/frames uploads/reports

RUN chmod +x start.sh

EXPOSE 8000

CMD ["./start.sh"]
