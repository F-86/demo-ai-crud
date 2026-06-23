#!/bin/bash
# Start the full demo (backend + frontend)
echo "Starting backend..."
cd "$(dirname "$0")/backend"
PYTHONPATH=. python3 main.py &
BACKEND_PID=$!
echo "Backend running (PID: $BACKEND_PID) at http://localhost:8000"

echo "Starting frontend..."
cd "$(dirname "$0")/frontend"
BROWSER=none PORT=33177 npx react-scripts start &
FRONTEND_PID=$!
echo "Frontend building (PID: $FRONTEND_PID) at http://localhost:33177"

echo ""
echo "=== Demo started ==="
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:8000"
echo "  API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
