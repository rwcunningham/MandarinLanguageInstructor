import json
import os
import re
from datetime import datetime, timedelta
from functools import wraps
from typing import Optional

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)
CORS(app)

mysql_uri = os.getenv("MYSQL_URI", "mysql+pymysql://root:password@localhost:3306/mandarin_reader")
if os.getenv("USE_SQLITE", "0") == "1":
    mysql_uri = "sqlite:///mandarin_reader.db"

app.config["SQLALCHEMY_DATABASE_URI"] = mysql_uri
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret")

db = SQLAlchemy(app)
TOKENS = {}


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Story(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    level = db.Column(db.String(20), nullable=False)
    content_json = db.Column(db.Text, nullable=False)


class Flashcard(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    source_text = db.Column(db.String(255), nullable=False)
    pinyin = db.Column(db.String(255), nullable=True)
    translation = db.Column(db.String(255), nullable=False)
    granularity = db.Column(db.String(20), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


def auth_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return jsonify({"error": "Missing bearer token"}), 401
        token = auth.replace("Bearer ", "")
        payload = TOKENS.get(token)
        if not payload or payload["exp"] < datetime.utcnow():
            return jsonify({"error": "Invalid or expired token"}), 401
        request.user_id = payload["user_id"]
        return f(*args, **kwargs)

    return decorated


def create_token(user_id: int) -> str:
    token = os.urandom(24).hex()
    TOKENS[token] = {"user_id": user_id, "exp": datetime.utcnow() + timedelta(hours=24)}
    return token


LOCAL_DICTIONARY = {
    "你好": {"translation": "hello", "pinyin": "nǐ hǎo", "granularity": "word"},
    "今天": {"translation": "today", "pinyin": "jīn tiān", "granularity": "word"},
    "公园": {"translation": "park", "pinyin": "gōng yuán", "granularity": "word"},
    "在": {"translation": "to be at/in", "pinyin": "zài", "granularity": "character"},
    "我": {"translation": "I; me", "pinyin": "wǒ", "granularity": "character"},
    "我们": {"translation": "we", "pinyin": "wǒ men", "granularity": "word"},
    "猫": {"translation": "cat", "pinyin": "māo", "granularity": "character"},
    "朋友": {"translation": "friend", "pinyin": "péng you", "granularity": "word"},
    "我们一起喝热茶。": {"translation": "We drink hot tea together.", "pinyin": "wǒ men yì qǐ hē rè chá", "granularity": "sentence"},
}


def heuristic_granularity(text: str) -> str:
    char_count = len(re.sub(r"\s", "", text))
    if char_count <= 1:
        return "character"
    if char_count <= 3:
        return "word"
    if char_count <= 9:
        return "phrase"
    if char_count <= 20:
        return "clause"
    return "sentence"


def fetch_translation(text: str) -> Optional[str]:
    try:
        response = requests.get(
            "https://api.mymemory.translated.net/get",
            params={"q": text, "langpair": "zh-CN|en-US"},
            timeout=4,
        )
        data = response.json()
        return data.get("responseData", {}).get("translatedText")
    except Exception:
        return None


@app.post("/api/auth/register")
def register():
    payload = request.get_json(force=True)
    username = payload.get("username", "").strip()
    password = payload.get("password", "")
    if not username or len(password) < 6:
        return jsonify({"error": "Username and password (>=6 chars) required"}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({"error": "Username already exists"}), 409

    user = User(username=username, password_hash=generate_password_hash(password))
    db.session.add(user)
    db.session.commit()
    token = create_token(user.id)
    return jsonify({"token": token, "username": username})


@app.post("/api/auth/login")
def login():
    payload = request.get_json(force=True)
    username = payload.get("username", "").strip()
    password = payload.get("password", "")
    user = User.query.filter_by(username=username).first()
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({"error": "Invalid credentials"}), 401
    token = create_token(user.id)
    return jsonify({"token": token, "username": username})


@app.get("/api/levels")
@auth_required
def levels():
    levels_set = sorted({s.level for s in Story.query.all()})
    return jsonify({"levels": levels_set})


@app.get("/api/stories")
@auth_required
def stories():
    level = request.args.get("level")
    query = Story.query
    if level:
        query = query.filter_by(level=level)
    result = [{"id": s.id, "title": s.title, "level": s.level} for s in query.order_by(Story.id).all()]
    return jsonify({"stories": result})


@app.get("/api/stories/<int:story_id>")
@auth_required
def story(story_id: int):
    s = Story.query.get_or_404(story_id)
    return jsonify({
        "id": s.id,
        "title": s.title,
        "level": s.level,
        "segments": json.loads(s.content_json),
    })


@app.post("/api/lookup")
@auth_required
def lookup():
    payload = request.get_json(force=True)
    text = payload.get("text", "").strip()
    if not text:
        return jsonify({"error": "Text required"}), 400

    entry = LOCAL_DICTIONARY.get(text)
    granularity = payload.get("granularity") or heuristic_granularity(text)
    translation = entry["translation"] if entry else fetch_translation(text) or "Translation unavailable"
    pinyin = entry["pinyin"] if entry else payload.get("pinyin", "")

    return jsonify({
        "text": text,
        "granularity": entry["granularity"] if entry else granularity,
        "translation": translation,
        "pinyin": pinyin,
    })


@app.get("/api/flashcards")
@auth_required
def list_flashcards():
    cards = Flashcard.query.filter_by(user_id=request.user_id).order_by(Flashcard.created_at.desc()).all()
    return jsonify({
        "flashcards": [
            {
                "id": c.id,
                "source_text": c.source_text,
                "pinyin": c.pinyin,
                "translation": c.translation,
                "granularity": c.granularity,
            }
            for c in cards
        ]
    })


@app.post("/api/flashcards")
@auth_required
def add_flashcard():
    payload = request.get_json(force=True)
    required = ["source_text", "translation", "granularity"]
    if any(not payload.get(r) for r in required):
        return jsonify({"error": "source_text, translation, granularity are required"}), 400

    card = Flashcard(
        user_id=request.user_id,
        source_text=payload["source_text"],
        pinyin=payload.get("pinyin", ""),
        translation=payload["translation"],
        granularity=payload["granularity"],
    )
    db.session.add(card)
    db.session.commit()
    return jsonify({"message": "Flashcard saved", "id": card.id}), 201


SEED_STORIES = [
    {
        "title": "公园里的早晨",
        "level": "beginner",
        "segments": [
            {"hanzi": "今天", "pinyin": "jīn tiān", "english": "today"},
            {"hanzi": "早上", "pinyin": "zǎo shang", "english": "morning"},
            {"hanzi": "，", "pinyin": "", "english": ","},
            {"hanzi": "我", "pinyin": "wǒ", "english": "I"},
            {"hanzi": "在", "pinyin": "zài", "english": "am at"},
            {"hanzi": "公园", "pinyin": "gōng yuán", "english": "park"},
            {"hanzi": "散步", "pinyin": "sàn bù", "english": "walk"},
            {"hanzi": "。", "pinyin": "", "english": "."},
            {"hanzi": "我", "pinyin": "wǒ", "english": "I"},
            {"hanzi": "看到", "pinyin": "kàn dào", "english": "see"},
            {"hanzi": "一只", "pinyin": "yì zhī", "english": "one (animal)"},
            {"hanzi": "猫", "pinyin": "māo", "english": "cat"},
            {"hanzi": "。", "pinyin": "", "english": "."},
        ],
    },
    {
        "title": "一起喝茶",
        "level": "intermediate",
        "segments": [
            {"hanzi": "下午", "pinyin": "xià wǔ", "english": "afternoon"},
            {"hanzi": "，", "pinyin": "", "english": ","},
            {"hanzi": "我", "pinyin": "wǒ", "english": "I"},
            {"hanzi": "和", "pinyin": "hé", "english": "and"},
            {"hanzi": "朋友", "pinyin": "péng you", "english": "friend"},
            {"hanzi": "在", "pinyin": "zài", "english": "at"},
            {"hanzi": "小店", "pinyin": "xiǎo diàn", "english": "small shop"},
            {"hanzi": "聊天", "pinyin": "liáo tiān", "english": "chat"},
            {"hanzi": "。", "pinyin": "", "english": "."},
            {"hanzi": "我们", "pinyin": "wǒ men", "english": "we"},
            {"hanzi": "一起", "pinyin": "yì qǐ", "english": "together"},
            {"hanzi": "喝", "pinyin": "hē", "english": "drink"},
            {"hanzi": "热茶", "pinyin": "rè chá", "english": "hot tea"},
            {"hanzi": "。", "pinyin": "", "english": "."},
        ],
    },
]


def seed_if_empty():
    if Story.query.count() == 0:
        for item in SEED_STORIES:
            db.session.add(
                Story(title=item["title"], level=item["level"], content_json=json.dumps(item["segments"], ensure_ascii=False))
            )
        db.session.commit()


@app.cli.command("init-db")
def init_db_cmd():
    db.create_all()
    seed_if_empty()
    print("Database initialized")


if __name__ == "__main__":
    with app.app_context():
        db.create_all()
        seed_if_empty()
    app.run(host="0.0.0.0", port=5000, debug=True)
