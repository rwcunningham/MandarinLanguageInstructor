# Mandarin Language Instructor

A full-stack Chinese learning app using **Flask + MySQL + React** where users can:

- Register/login with password hashing (Werkzeug)
- Choose reading level and short Mandarin stories
- Read hanzi with pinyin (tone marks)
- Click or drag-select text to fetch definitions/translations
- See lookup results in speech-bubble overlays
- Save lookups to flashcards
- Listen to selected text or whole story with browser TTS

---

## 1) Linux setup commands (after clone + `cd MandarinLanguageInstructor`)

The commands below assume Ubuntu/Debian Linux.

### 1.1 Install system dependencies

```bash
sudo apt update
sudo apt install -y \
  git \
  curl \
  build-essential \
  python3 \
  python3-venv \
  python3-pip \
  mysql-server \
  nodejs \
  npm
```

> Optional (recommended): install Node 20 via NodeSource if your distro Node is old.

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 1.2 Verify installed versions

```bash
python3 --version
pip3 --version
node --version
npm --version
mysql --version
```

---

## 2) Local development setup (MySQL + Flask + React)

Run these commands **from the repo root** (`MandarinLanguageInstructor`).

### 2.1 Configure MySQL

Start and enable MySQL:

```bash
sudo systemctl enable --now mysql
```

Create the app database/user (you can change password if you want):

```bash
sudo mysql -e "CREATE DATABASE IF NOT EXISTS mandarin_reader CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER IF NOT EXISTS 'mandarin_user'@'localhost' IDENTIFIED BY 'mandarin_pass';"
sudo mysql -e "GRANT ALL PRIVILEGES ON mandarin_reader.* TO 'mandarin_user'@'localhost';"
sudo mysql -e "FLUSH PRIVILEGES;"
```

### 2.2 Backend setup (Flask)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

Set environment variables for backend runtime:

```bash
export MYSQL_URI="mysql+pymysql://mandarin_user:mandarin_pass@localhost:3306/mandarin_reader"
export SECRET_KEY="change-me-in-real-use"
```

Launch backend:

```bash
python app.py
```

Backend runs at: <http://localhost:5000>

### 2.3 Frontend setup (React + Vite)

Open a **new terminal**, then run:

```bash
cd /path/to/MandarinLanguageInstructor/frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

Frontend runs at: <http://localhost:5173>

---

## 3) Launch sequence (quick reference)

From repo root:

### Terminal A (backend)

```bash
cd backend
source .venv/bin/activate
export MYSQL_URI="mysql+pymysql://mandarin_user:mandarin_pass@localhost:3306/mandarin_reader"
export SECRET_KEY="change-me-in-real-use"
python app.py
```

### Terminal B (frontend)

```bash
cd frontend
npm run dev -- --host 0.0.0.0 --port 5173
```

Then open <http://localhost:5173> in your browser.

---

## 4) Docker alternative (fastest way to run)

If you prefer Docker instead of local package installation:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
newgrp docker
```

From repo root:

```bash
docker compose up --build
```

- Frontend: <http://localhost:5173>
- Backend: <http://localhost:5000>
- MySQL: `localhost:3306`

To stop:

```bash
docker compose down
```

---

## 5) SQLite fallback (if you do not want MySQL locally)

From repo root:

```bash
cd backend
source .venv/bin/activate
export USE_SQLITE=1
python app.py
```

This runs backend with a local SQLite DB (`backend/mandarin_reader.db`).

---

## 6) Main API routes

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/levels`
- `GET /api/stories?level=beginner`
- `GET /api/stories/<id>`
- `POST /api/lookup`
- `GET /api/flashcards`
- `POST /api/flashcards`
