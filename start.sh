#!/bin/bash
ROOT="$(cd "$(dirname "$0")" && pwd)"

# 安装依赖
echo "Installing backend dependencies..."
(cd "$ROOT/backend" && uv sync)

echo "Installing frontend dependencies..."
(cd "$ROOT/frontend" && npm install)

# Start the full demo (backend + frontend)
echo "Starting backend..."
(cd "$ROOT/backend" && PYTHONPATH=. uv run python main.py) &
BACKEND_PID=$!
echo "Backend running (PID: $BACKEND_PID) at http://localhost:8000"

echo "Starting frontend..."
(cd "$ROOT/frontend" && BROWSER=none DANGEROUSLY_DISABLE_HOST_CHECK=true PORT=33177 npm start) &
FRONTEND_PID=$!
echo "Frontend building (PID: $FRONTEND_PID) at http://localhost:33177"

echo ""
echo "=== Demo started ==="
echo "  Frontend: http://localhost:33177"
echo "  Backend:  http://localhost:8000"
echo "  API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
