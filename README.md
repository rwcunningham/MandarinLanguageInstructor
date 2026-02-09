# Mandarin Language Instructor

A full-stack Chinese learning app using **Flask + MySQL + React**.

## What it does

- User signup/login with hashed passwords
- Mandarin short stories by level
- Hanzi + pinyin reading view
- Character/word/phrase/clause/sentence lookup
- Flashcard saving
- Browser text-to-speech

## Start here

- Linux setup + all commands: **[docs/SETUP_LINUX.md](docs/SETUP_LINUX.md)**
- Docker quick start:

```bash
docker compose up --build
```

- Frontend: <http://localhost:5173>
- Backend: <http://localhost:5000>

## API routes

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/levels`
- `GET /api/stories?level=beginner`
- `GET /api/stories/<id>`
- `POST /api/lookup`
- `GET /api/flashcards`
- `POST /api/flashcards`
