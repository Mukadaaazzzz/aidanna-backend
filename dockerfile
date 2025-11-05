FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Don't use EXPOSE - Railway ignores it
# Just start uvicorn directly with Railway's PORT
CMD uvicorn main:app --host 0.0.0.0 --port $PORT