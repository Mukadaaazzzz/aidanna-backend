# Use official Python image
FROM python:3.11-slim

# Set work directory
WORKDIR /app

# Copy dependencies and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the app
COPY . .

# Expose the port (optional but helpful)
EXPOSE 8000

# Start the FastAPI app
CMD ["python", "main.py"]
