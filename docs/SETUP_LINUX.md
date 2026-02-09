# Linux Setup and Launch Guide

Use these commands after cloning and entering the repo directory:

```bash
git clone https://github.com/rwcunningham/MandarinLanguageInstructor.git
cd MandarinLanguageInstructor
```

## 1) Install system packages (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install -y git curl build-essential python3 python3-venv python3-pip mysql-server nodejs npm
```

Optional newer Node.js:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify:

```bash
python3 --version
pip3 --version
node --version
npm --version
mysql --version
```

## 2) Configure MySQL

```bash
sudo systemctl enable --now mysql
sudo mysql -e "CREATE DATABASE IF NOT EXISTS mandarin_reader CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER IF NOT EXISTS 'mandarin_user'@'localhost' IDENTIFIED BY 'mandarin_pass';"
sudo mysql -e "GRANT ALL PRIVILEGES ON mandarin_reader.* TO 'mandarin_user'@'localhost';"
sudo mysql -e "FLUSH PRIVILEGES;"
```

## 3) Backend dependencies

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
cd ..
```

## 4) Frontend dependencies

```bash
cd frontend
npm install
cd ..
```

## 5) Launch app

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

Open <http://localhost:5173>.

## Docker option

```bash
docker compose up --build
```

## SQLite fallback

```bash
cd backend
source .venv/bin/activate
export USE_SQLITE=1
python app.py
```
