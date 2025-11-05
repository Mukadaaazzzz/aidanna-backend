# Use official Python image
FROM python:3.11-slim

# Set work directory
WORKDIR /app

# Copy dependencies and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the app
COPY . .

# Expose port (Railway will override with $PORT)
EXPOSE 8000

# Use shell form to allow $PORT env var substitution
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}