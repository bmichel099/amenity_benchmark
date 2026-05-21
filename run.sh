#!/usr/bin/env bash
# Start the Amenity Benchmark server.
# Usage: ./run.sh [port]
set -e

PORT=${1:-8000}

# Load .env if present
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

echo "Starting Amenity Benchmark on http://localhost:$PORT"
uvicorn app:app --host 0.0.0.0 --port "$PORT" --reload
