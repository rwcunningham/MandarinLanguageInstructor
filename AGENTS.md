# Agent Notes

## Startup Procedure

Backend:
- Start with `backend/.venv/bin/python`.
- Listen on `http://127.0.0.1:5001`.
- Verify `/api/levels` responds with `401 Missing bearer token`, which is expected without auth.

Frontend:
- Start with `npm run dev -- --host 127.0.0.1`.
- Listen on `http://127.0.0.1:5173/`.
- Verify frontend returns `HTTP/1.1 200 OK`.

Use: `http://localhost:5173/`
