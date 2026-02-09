# Mandarin Language Instructor

A full-stack learning app using **Flask + MySQL + React** where users can:

- Register/login with password hashing (Werkzeug)
- Choose reading level and short Mandarin stories
- Read hanzi with pinyin (tone marks)
- Click or drag-select text to fetch definitions/translations
- See lookup results in speech-bubble overlays
- Save lookups to flashcards
- Listen to selected text or whole story with browser TTS

## Architecture

- **Backend**: Flask + SQLAlchemy + MySQL (`backend/app.py`)
- **Frontend**: React + Vite (`frontend/src/App.jsx`)
- **Database**: MySQL 8 (Docker Compose)
- **Lookup source**:
  - Local seed dictionary for common words/characters
  - Fallback to free MyMemory translation API for phrase/clause/sentence lookups

## Quick start (Docker)

```bash
docker compose up --build
```

Frontend: <http://localhost:5173>
Backend API: <http://localhost:5000>

## Local dev

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export USE_SQLITE=1
python app.py
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Main API routes

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/levels`
- `GET /api/stories?level=beginner`
- `GET /api/stories/<id>`
- `POST /api/lookup`
- `GET /api/flashcards`
- `POST /api/flashcards`

