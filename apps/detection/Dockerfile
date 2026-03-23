FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download spacy transformer model for best NER accuracy
# en_core_web_trf = transformer-based, highest accuracy
# Fallback: en_core_web_lg if transformer model is too large for deployment
RUN python -m spacy download en_core_web_lg

# Copy source
COPY src/ src/

# Non-root user for security
RUN groupadd -r irongate && useradd -r -g irongate irongate
USER irongate

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')"

CMD ["python", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "2"]
