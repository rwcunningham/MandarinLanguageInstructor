# Mandarin Language Instructor

A full-stack Chinese learning app using **Flask + MySQL + React** where users can:

- Register/login with password hashing (Werkzeug)
- Choose reading level and short Mandarin stories
- Read hanzi with pinyin (tone marks)
- Click or drag-select text to fetch definitions/translations
- See lookup results in speech-bubble overlays
- Save lookups to flashcards
- Listen to selected text or whole story with browser TTS

## Quick start (Docker)

```bash
docker compose up --build
```

- Frontend: <http://localhost:5173>
- Backend: <http://localhost:5000>

---

## Linux setup commands (after `git clone` + `cd MandarinLanguageInstructor`)

The following are the full commands for Ubuntu/Debian.

### 1) Install system dependencies

```bash
sudo apt update
sudo apt install -y git curl build-essential python3 python3-venv python3-pip mysql-server nodejs npm
```

Optional (recommended) for newer Node.js:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify tools:

```bash
python3 --version
pip3 --version
node --version
npm --version
mysql --version
```

### 2) Configure MySQL database

```bash
sudo systemctl enable --now mysql
sudo mysql -e "CREATE DATABASE IF NOT EXISTS mandarin_reader CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER IF NOT EXISTS 'mandarin_user'@'localhost' IDENTIFIED BY 'mandarin_pass';"
sudo mysql -e "GRANT ALL PRIVILEGES ON mandarin_reader.* TO 'mandarin_user'@'localhost';"
sudo mysql -e "FLUSH PRIVILEGES;"
```

### 3) Install backend dependencies (Flask)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 4) Install frontend dependencies (React)

Open a second terminal in the repo root:

```bash
cd frontend
npm install
```

### 5) Launch the program

Terminal A (backend):

```bash
cd backend
source .venv/bin/activate
export MYSQL_URI="mysql+pymysql://mandarin_user:mandarin_pass@localhost:3306/mandarin_reader"
export SECRET_KEY="change-me-in-real-use"
python app.py
```

Terminal B (frontend):

```bash
cd frontend
npm run dev -- --host 0.0.0.0 --port 5173
```

Open the app at <http://localhost:5173>.

---

## SQLite fallback (no MySQL)

```bash
cd backend
source .venv/bin/activate
export USE_SQLITE=1
python app.py
```

---

## Main API routes

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/levels`
- `GET /api/stories?level=beginner`
- `GET /api/stories/<id>`
- `POST /api/lookup`
- `GET /api/flashcards`
- `POST /api/flashcards`
