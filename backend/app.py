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
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)
CORS(app)

mysql_uri = os.getenv("MYSQL_URI")
if os.getenv("USE_SQLITE", "0") == "1" or not mysql_uri:
    mysql_uri = "sqlite:///mandarin_reader.db"

app.config["SQLALCHEMY_DATABASE_URI"] = mysql_uri
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret")

db = SQLAlchemy(app)
TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24
token_serializer = URLSafeTimedSerializer(app.config["SECRET_KEY"])
LEVEL_ORDER = ["beginner", "intermediate", "advanced"]
LEITNER_INTERVAL_DAYS = {
    1: 1,
    2: 2,
    3: 4,
    4: 7,
    5: 14,
}
DIRECTION_MASTERY_THRESHOLD = 3


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
    story_id = db.Column(db.Integer, db.ForeignKey("story.id"), nullable=True)
    source_text = db.Column(db.String(255), nullable=False)
    pinyin = db.Column(db.String(255), nullable=True)
    translation = db.Column(db.String(255), nullable=False)
    granularity = db.Column(db.String(20), nullable=False)
    context_sentence = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(20), default="new", nullable=False)
    last_rating = db.Column(db.String(20), nullable=True)
    leitner_box = db.Column(db.Integer, default=1, nullable=False)
    leitner_due_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    due_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    interval_days = db.Column(db.Integer, default=0, nullable=False)
    ease = db.Column(db.Float, default=2.5, nullable=False)
    review_count = db.Column(db.Integer, default=0, nullable=False)
    zh_to_en_correct_count = db.Column(db.Integer, default=0, nullable=False)
    en_to_zh_correct_count = db.Column(db.Integer, default=0, nullable=False)
    last_reviewed_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class UserProfile(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), unique=True, nullable=False)
    current_level = db.Column(db.String(20), default="beginner", nullable=False)
    pinyin_mode = db.Column(db.String(20), default="always", nullable=False)
    english_mode = db.Column(db.String(20), default="hidden", nullable=False)
    goal = db.Column(db.String(80), default="reading", nullable=False)
    daily_goal = db.Column(db.Integer, default=10, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class StoryProgress(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    story_id = db.Column(db.Integer, db.ForeignKey("story.id"), nullable=False)
    status = db.Column(db.String(20), default="reading", nullable=False)
    last_segment_index = db.Column(db.Integer, default=0, nullable=False)
    lookup_count = db.Column(db.Integer, default=0, nullable=False)
    saved_count = db.Column(db.Integer, default=0, nullable=False)
    comprehension = db.Column(db.String(20), nullable=True)
    completed_at = db.Column(db.DateTime, nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    __table_args__ = (db.UniqueConstraint("user_id", "story_id", name="uq_story_progress_user_story"),)


class LookupEvent(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    story_id = db.Column(db.Integer, db.ForeignKey("story.id"), nullable=True)
    text = db.Column(db.String(255), nullable=False)
    granularity = db.Column(db.String(20), nullable=False)
    source = db.Column(db.String(40), nullable=False)
    segment_index = db.Column(db.Integer, nullable=True)
    sentence_text = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class ReviewEvent(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    flashcard_id = db.Column(db.Integer, db.ForeignKey("flashcard.id"), nullable=False)
    rating = db.Column(db.String(20), nullable=False)
    previous_due_at = db.Column(db.DateTime, nullable=True)
    next_due_at = db.Column(db.DateTime, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class FlashcardPracticeSession(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    practice_filter = db.Column(db.String(40), nullable=False)
    total_cards = db.Column(db.Integer, default=0, nullable=False)
    correct_count = db.Column(db.Integer, default=0, nullable=False)
    incorrect_count = db.Column(db.Integer, default=0, nullable=False)
    score_percent = db.Column(db.Integer, default=0, nullable=False)
    rating_breakdown_json = db.Column(db.Text, nullable=False, default="{}")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class QuizAttempt(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    story_id = db.Column(db.Integer, db.ForeignKey("story.id"), nullable=False)
    total_questions = db.Column(db.Integer, default=0, nullable=False)
    correct_count = db.Column(db.Integer, default=0, nullable=False)
    score_percent = db.Column(db.Integer, default=0, nullable=False)
    elapsed_seconds = db.Column(db.Integer, default=0, nullable=False)
    answers_json = db.Column(db.Text, nullable=False, default="{}")
    passed = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


def auth_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return jsonify({"error": "Missing bearer token"}), 401
        token = auth.replace("Bearer ", "")
        try:
            payload = token_serializer.loads(token, max_age=TOKEN_MAX_AGE_SECONDS)
        except SignatureExpired:
            return jsonify({"error": "Expired token"}), 401
        except BadSignature:
            return jsonify({"error": "Invalid or expired token"}), 401
        request.user_id = payload["user_id"]
        return f(*args, **kwargs)

    return decorated


def create_token(user_id: int) -> str:
    return token_serializer.dumps({"user_id": user_id})


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
    "今天早上，我在公园散步。": {"translation": "This morning, I am taking a walk in the park.", "pinyin": "jīn tiān zǎo shang, wǒ zài gōng yuán sàn bù", "granularity": "sentence"},
    "我看到一只猫。": {"translation": "I see a cat.", "pinyin": "wǒ kàn dào yì zhī māo", "granularity": "sentence"},
    "我和朋友在小店聊天。": {"translation": "My friend and I are chatting in a small shop.", "pinyin": "wǒ hé péng you zài xiǎo diàn liáo tiān", "granularity": "sentence"},
    "早上": {"translation": "morning", "pinyin": "zǎo shang", "granularity": "word"},
    "散步": {"translation": "to take a walk", "pinyin": "sàn bù", "granularity": "word"},
    "看到": {"translation": "to see", "pinyin": "kàn dào", "granularity": "word"},
    "一只": {"translation": "one (measure phrase for animals)", "pinyin": "yì zhī", "granularity": "phrase"},
    "下午": {"translation": "afternoon", "pinyin": "xià wǔ", "granularity": "word"},
    "和": {"translation": "and; with", "pinyin": "hé", "granularity": "character"},
    "小店": {"translation": "small shop", "pinyin": "xiǎo diàn", "granularity": "word"},
    "聊天": {"translation": "to chat", "pinyin": "liáo tiān", "granularity": "word"},
    "一起": {"translation": "together", "pinyin": "yì qǐ", "granularity": "word"},
    "喝": {"translation": "to drink", "pinyin": "hē", "granularity": "character"},
    "热茶": {"translation": "hot tea", "pinyin": "rè chá", "granularity": "word"},
}

GRAMMAR_NOTES = {
    "今天早上，我在公园散步。": "今天早上 sets the time first; 在公园 places the action before 散步.",
    "我在公园散步。": "Subject + 在 + place + action: 在公园 tells where the action happens.",
    "我看到一只猫。": "一只 is a number plus measure word phrase commonly used before animals.",
    "我和朋友在小店聊天。": "和 links people together; 在小店 places the chatting in a small shop.",
    "我们一起喝热茶。": "一起 marks that the action is done together by the group.",
}


def literal_translation_from_segments(segments) -> str:
    return " ".join(
        item.get("english", "")
        for item in segments
        if item.get("english") not in {"", ",", "."}
    )


def natural_translation_for_sentence(hanzi: str, literal_translation: str) -> str:
    entry = LOCAL_DICTIONARY.get(hanzi, {})
    return NATURAL_SENTENCE_TRANSLATIONS.get(hanzi) or entry.get("translation") or literal_translation


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


def build_sentences(segments):
    sentences = []
    current = []
    start_index = 0
    for index, segment in enumerate(segments):
        if not current:
            start_index = index
        current.append(segment)
        if segment.get("hanzi") in {"。", "！", "？", "!", "?"}:
            hanzi = "".join(item.get("hanzi", "") for item in current)
            pinyin = " ".join(item.get("pinyin", "") for item in current if item.get("pinyin"))
            literal_english = literal_translation_from_segments(current)
            natural_english = natural_translation_for_sentence(hanzi, literal_english)
            sentences.append({
                "id": len(sentences),
                "start_segment": start_index,
                "end_segment": index,
                "hanzi": hanzi,
                "pinyin": pinyin,
                "english": literal_english,
                "literal_english": literal_english,
                "natural_english": natural_english,
                "grammar_note": GRAMMAR_NOTES.get(hanzi, ""),
            })
            current = []

    if current:
        hanzi = "".join(item.get("hanzi", "") for item in current)
        pinyin = " ".join(item.get("pinyin", "") for item in current if item.get("pinyin"))
        literal_english = literal_translation_from_segments(current)
        natural_english = natural_translation_for_sentence(hanzi, literal_english)
        sentences.append({
            "id": len(sentences),
            "start_segment": start_index,
            "end_segment": start_index + len(current) - 1,
            "hanzi": hanzi,
            "pinyin": pinyin,
            "english": literal_english,
            "literal_english": literal_english,
            "natural_english": natural_english,
            "grammar_note": GRAMMAR_NOTES.get(hanzi, ""),
        })

    return sentences


def get_or_create_profile(user_id: int) -> UserProfile:
    profile = UserProfile.query.filter_by(user_id=user_id).first()
    if not profile:
        profile = UserProfile(user_id=user_id)
        db.session.add(profile)
        db.session.commit()
    return profile


def get_or_create_story_progress(user_id: int, story_id: int) -> StoryProgress:
    progress = StoryProgress.query.filter_by(user_id=user_id, story_id=story_id).first()
    if not progress:
        progress = StoryProgress(user_id=user_id, story_id=story_id)
        db.session.add(progress)
        db.session.commit()
    return progress


def serialize_profile(profile: UserProfile):
    return {
        "current_level": profile.current_level,
        "pinyin_mode": profile.pinyin_mode,
        "english_mode": profile.english_mode,
        "goal": profile.goal,
        "daily_goal": profile.daily_goal,
        "flashcard_history": [
            serialize_practice_session(session)
            for session in FlashcardPracticeSession.query
            .filter_by(user_id=profile.user_id)
            .order_by(FlashcardPracticeSession.created_at.desc())
            .limit(12)
            .all()
        ],
    }


def serialize_practice_session(session: FlashcardPracticeSession):
    try:
        rating_breakdown = json.loads(session.rating_breakdown_json or "{}")
    except json.JSONDecodeError:
        rating_breakdown = {}
    return {
        "id": session.id,
        "practice_filter": session.practice_filter,
        "total_cards": session.total_cards,
        "correct_count": session.correct_count,
        "incorrect_count": session.incorrect_count,
        "score_percent": session.score_percent,
        "rating_breakdown": rating_breakdown,
        "created_at": session.created_at.isoformat() if session.created_at else None,
    }


def flashcard_sentence_context(card: Flashcard):
    if not card.story_id or not card.context_sentence:
        return {}
    story_obj = Story.query.get(card.story_id)
    if not story_obj:
        return {}
    try:
        sentences = build_sentences(json.loads(story_obj.content_json))
    except (json.JSONDecodeError, TypeError):
        return {}
    match = next((sentence for sentence in sentences if sentence["hanzi"] == card.context_sentence), None)
    if not match:
        return {}
    return {
        "context_sentence_pinyin": match.get("pinyin", ""),
        "context_sentence_literal_english": match.get("literal_english", ""),
        "context_sentence_english": match.get("natural_english") or match.get("english", ""),
    }


def direction_correct_count(card: Flashcard, direction: str) -> int:
    if direction == "en-zh":
        return int(card.en_to_zh_correct_count or 0)
    return int(card.zh_to_en_correct_count or 0)


def direction_mastered(card: Flashcard, direction: str) -> bool:
    return direction_correct_count(card, direction) >= DIRECTION_MASTERY_THRESHOLD


def leitner_practice_direction(card: Flashcard) -> str:
    if direction_mastered(card, "zh-en") and not direction_mastered(card, "en-zh"):
        return "en-zh"
    return "zh-en"


def serialize_quiz_attempt(attempt: QuizAttempt):
    return {
        "id": attempt.id,
        "story_id": attempt.story_id,
        "total_questions": attempt.total_questions,
        "correct_count": attempt.correct_count,
        "score_percent": attempt.score_percent,
        "elapsed_seconds": attempt.elapsed_seconds,
        "passed": bool(attempt.passed),
        "created_at": attempt.created_at.isoformat() if attempt.created_at else None,
    }


def serialize_flashcard(card: Flashcard):
    return {
        "id": card.id,
        "source_text": card.source_text,
        "pinyin": card.pinyin,
        "translation": card.translation,
        "granularity": card.granularity,
        "context_sentence": card.context_sentence,
        **flashcard_sentence_context(card),
        "story_id": card.story_id,
        "status": card.status,
        "last_rating": card.last_rating,
        "leitner_box": card.leitner_box or 1,
        "leitner_due_at": card.leitner_due_at.isoformat() if card.leitner_due_at else None,
        "due_at": card.due_at.isoformat() if card.due_at else None,
        "interval_days": card.interval_days,
        "ease": card.ease,
        "review_count": card.review_count,
        "zh_to_en_correct_count": int(card.zh_to_en_correct_count or 0),
        "en_to_zh_correct_count": int(card.en_to_zh_correct_count or 0),
        "direction_mastery_threshold": DIRECTION_MASTERY_THRESHOLD,
        "zh_to_en_mastered": direction_mastered(card, "zh-en"),
        "en_to_zh_mastered": direction_mastered(card, "en-zh"),
        "leitner_direction": leitner_practice_direction(card),
        "leitner_mastered": direction_mastered(card, "zh-en") and direction_mastered(card, "en-zh"),
        "last_reviewed_at": card.last_reviewed_at.isoformat() if card.last_reviewed_at else None,
        "created_at": card.created_at.isoformat() if card.created_at else None,
    }


def normalize_answer(value: str) -> str:
    return re.sub(r"[\s，。！？!?、；;：:,.']", "", str(value or "").lower())


def story_words(segments):
    words = []
    seen = set()
    for segment in segments:
        text_value = segment.get("hanzi", "").strip()
        if not text_value or not segment.get("pinyin") or text_value in {"，", "。", "！", "？", "、"}:
            continue
        if text_value in seen:
            continue
        seen.add(text_value)
        words.append({
            "hanzi": text_value,
            "pinyin": segment.get("pinyin", ""),
            "english": segment.get("english", ""),
        })
    return words


def option_pool(current, candidates, key):
    options = [current[key]]
    for candidate in candidates:
        value = candidate.get(key, "")
        if value and value not in options:
            options.append(value)
        if len(options) == 4:
            break
    return options


GENERIC_STORY_DISTRACTORS = [
    "Someone buys train tickets before a trip.",
    "A teacher writes a new lesson on the board.",
    "A child loses a hat on the bus.",
    "Two classmates play basketball after school.",
]


def sentence_meaning(sentence):
    return sentence.get("natural_english") or sentence.get("english") or ""


def global_sentence_distractors(current_meaning, limit=3):
    distractors = []
    for value in NATURAL_SENTENCE_TRANSLATIONS.values():
        if len(distractors) >= limit:
            break
        if value and value != current_meaning and value not in distractors:
            distractors.append(value)
    for value in GENERIC_STORY_DISTRACTORS:
        if len(distractors) >= limit:
            break
        if value != current_meaning and value not in distractors:
            distractors.append(value)
    return distractors


def rotate_options(options, seed_text):
    if len(options) <= 1:
        return options
    offset = sum(ord(char) for char in seed_text) % len(options)
    return options[offset:] + options[:offset]


def public_question(question):
    return {
        key: value
        for key, value in question.items()
        if key not in {"answer", "accepted_answers", "explanation"}
    }


def public_quiz(quiz_data):
    return {
        "story": quiz_data["story"],
        "questions": [public_question(question) for question in quiz_data["questions"]],
    }


def build_story_quiz(story_obj: Story):
    segments = json.loads(story_obj.content_json)
    sentences = build_sentences(segments)
    words = story_words(segments)
    questions = []

    if words:
        word = words[0]
        questions.append({
            "id": "word-zh-en-0",
            "type": "multiple_choice",
            "skill": "Vocabulary",
            "prompt": f"What does “{word['hanzi']}” mean?",
            "choices": rotate_options(option_pool(word, words[1:], "english"), f"word-zh-en-{word['hanzi']}"),
            "answer": word["english"],
            "supporting_text": word["pinyin"],
            "explanation": f"{word['hanzi']} is read {word['pinyin']} and means “{word['english']}.”",
        })

    if len(sentences) > 0:
        sentence = sentences[0]
        meaning = sentence_meaning(sentence)
        questions.append({
            "id": "audio-meaning-0",
            "type": "audio_choice",
            "skill": "Listening",
            "prompt": "Listen to the sentence, then choose its meaning.",
            "audio_text": sentence["hanzi"],
            "choices": rotate_options([meaning, *global_sentence_distractors(meaning)], f"audio-meaning-{sentence['hanzi']}"),
            "answer": meaning,
            "supporting_text": sentence["pinyin"],
            "explanation": f"The sentence is {sentence['hanzi']} — {meaning}",
        })

    if len(sentences) > 1:
        sentence = sentences[1]
        sentence_choices = option_pool(
            {"hanzi": sentence["hanzi"]},
            [{"hanzi": item["hanzi"]} for item in sentences if item["hanzi"] != sentence["hanzi"]],
            "hanzi",
        )
        questions.append({
            "id": "audio-match-0",
            "type": "audio_choice",
            "skill": "Listening + Reading",
            "prompt": "Listen, then choose the Chinese sentence you heard.",
            "audio_text": sentence["hanzi"],
            "choices": rotate_options(sentence_choices, f"audio-match-{sentence['hanzi']}"),
            "answer": sentence["hanzi"],
            "supporting_text": sentence["pinyin"],
            "explanation": f"You heard: {sentence['hanzi']}",
        })

    if words and sentences:
        gap_word = words[min(2, len(words) - 1)]
        source_sentence = next((sentence for sentence in sentences if gap_word["hanzi"] in sentence["hanzi"]), sentences[0])
        prompt_sentence = source_sentence["hanzi"].replace(gap_word["hanzi"], "____", 1)
        questions.append({
            "id": "gap-fill-0",
            "type": "gap_fill_choice",
            "skill": "Grammar",
            "prompt": f"Choose the missing Mandarin word: {prompt_sentence}",
            "choices": rotate_options(option_pool(gap_word, [item for item in words if item["hanzi"] != gap_word["hanzi"]], "hanzi"), f"gap-fill-{source_sentence['hanzi']}"),
            "answer": gap_word["hanzi"],
            "supporting_text": source_sentence["pinyin"],
            "explanation": f"The complete sentence is {source_sentence['hanzi']}",
        })

    if sentences:
        sentence = sentences[0]
        sentence_choices = option_pool(
            {"english": sentence_meaning(sentence)},
            [{"english": value} for value in global_sentence_distractors(sentence_meaning(sentence))],
            "english",
        )
        questions.append({
            "id": "sentence-zh-en-0",
            "type": "multiple_choice",
            "skill": "Reading",
            "prompt": f"Choose the best English translation for: {sentence['hanzi']}",
            "choices": rotate_options(sentence_choices, f"sentence-zh-en-{sentence['hanzi']}"),
            "answer": sentence_meaning(sentence),
            "supporting_text": sentence["pinyin"],
            "explanation": f"{sentence['hanzi']} means “{sentence_meaning(sentence)}.”",
        })

    if sentences:
        target = sentences[min(1, len(sentences) - 1)]
        meaning = sentence_meaning(target)
        questions.append({
            "id": "story-detail-0",
            "type": "multiple_choice",
            "skill": "Comprehension",
            "prompt": "Which event happens in this story?",
            "choices": rotate_options([meaning, *global_sentence_distractors(meaning)], f"story-detail-{target['hanzi']}"),
            "answer": meaning,
            "supporting_text": target["hanzi"],
            "explanation": f"This detail appears in the story: {target['hanzi']}",
        })

    if len(sentences) >= 2:
        ordered = sentences[:min(3, len(sentences))]
        answer = "||".join(sentence["hanzi"] for sentence in ordered)
        questions.append({
            "id": "story-sequence-0",
            "type": "sequence",
            "skill": "Comprehension",
            "prompt": "Put these story events in the order they happen.",
            "choices": rotate_options([sentence["hanzi"] for sentence in ordered], f"sequence-{story_obj.title}"),
            "answer": answer,
            "supporting_text": "Sequence the Chinese sentences.",
            "explanation": "The story order follows the original sentence order.",
        })

    if sentences:
        sentence = sentences[0]
        questions.append({
            "id": "speak-repeat-0",
            "type": "speaking_prompt",
            "skill": "Pronunciation practice",
            "prompt": "Listen and repeat this Mandarin sentence aloud.",
            "model_text": sentence["hanzi"],
            "audio_text": sentence["hanzi"],
            "answer": "practiced",
            "accepted_answers": ["practiced"],
            "supporting_text": sentence["pinyin"],
            "explanation": "Speaking practice is self-checked here: listen, repeat, then mark it practiced.",
        })

    return {
        "story": {
            "id": story_obj.id,
            "title": story_obj.title,
            "level": story_obj.level,
            **story_title_metadata(story_obj),
        },
        "questions": questions,
    }


def structured_lookup(text_value: str, requested_granularity: str, sentence_text: str = ""):
    entry = LOCAL_DICTIONARY.get(text_value)
    source = "local"
    translation = entry["translation"] if entry else None
    if not translation:
        translation = fetch_translation(text_value)
        source = "mymemory" if translation else "unavailable"
    if not translation:
        translation = "Translation unavailable"

    granularity = entry["granularity"] if entry else requested_granularity
    pinyin = entry["pinyin"] if entry else ""
    grammar_note = GRAMMAR_NOTES.get(text_value) or (GRAMMAR_NOTES.get(sentence_text) if sentence_text else "")
    literal_translation = LITERAL_SENTENCE_TRANSLATIONS.get(text_value) or translation
    natural_translation = NATURAL_SENTENCE_TRANSLATIONS.get(text_value) or translation
    definitions = [literal_translation] if literal_translation and literal_translation != "Translation unavailable" else []
    alternatives = []
    if sentence_text and sentence_text != text_value:
        sentence_literal = LITERAL_SENTENCE_TRANSLATIONS.get(sentence_text, "")
        sentence_natural = NATURAL_SENTENCE_TRANSLATIONS.get(sentence_text, "")
        alternatives.append({
            "label": "Sentence context",
            "text": sentence_text,
            "granularity": "sentence",
            "translation": sentence_literal or LOCAL_DICTIONARY.get(sentence_text, {}).get("translation", ""),
            "literal_translation": sentence_literal,
            "natural_translation": sentence_natural,
            "grammar_note": GRAMMAR_NOTES.get(sentence_text, ""),
        })
    if len(text_value) > 1:
        for char in text_value:
            char_entry = LOCAL_DICTIONARY.get(char)
            if char_entry:
                alternatives.append({
                    "label": "Character",
                    "text": char,
                    "granularity": "character",
                    "translation": char_entry["translation"],
                    "pinyin": char_entry["pinyin"],
                })

    return {
        "text": text_value,
        "normalized_text": text_value,
        "granularity": granularity,
        "translation": literal_translation,
        "natural_translation": natural_translation,
        "literal_translation": literal_translation,
        "definitions": definitions,
        "pinyin": pinyin,
        "grammar_note": grammar_note,
        "source": source,
        "confidence": "high" if source == "local" else "medium" if source == "mymemory" else "low",
        "alternatives": alternatives,
    }


@app.post("/api/auth/register")
def register():
    payload = request.get_json(silent=True) or {}
    username = payload.get("username", "").strip()
    password = payload.get("password", "")
    if not username or len(password) < 6:
        return jsonify({"error": "Username and password (>=6 chars) required"}), 400

    try:
        if User.query.filter_by(username=username).first():
            return jsonify({"error": "Username already exists"}), 409

        user = User(username=username, password_hash=generate_password_hash(password))
        db.session.add(user)
        db.session.commit()
        get_or_create_profile(user.id)
    except SQLAlchemyError:
        db.session.rollback()
        return jsonify({"error": "Database unavailable. Check backend DB configuration."}), 503

    token = create_token(user.id)
    return jsonify({"token": token, "username": username})


@app.post("/api/auth/login")
def login():
    payload = request.get_json(silent=True) or {}
    username = payload.get("username", "").strip()
    password = payload.get("password", "")

    try:
        user = User.query.filter_by(username=username).first()
    except SQLAlchemyError:
        return jsonify({"error": "Database unavailable. Check backend DB configuration."}), 503

    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({"error": "Invalid credentials"}), 401
    token = create_token(user.id)
    return jsonify({"token": token, "username": username})


@app.get("/api/levels")
@auth_required
def levels():
    levels_set = sorted({s.level for s in Story.query.all()}, key=level_sort_key)
    return jsonify({"levels": levels_set})


@app.get("/api/profile")
@auth_required
def get_profile():
    profile = get_or_create_profile(request.user_id)
    return jsonify({"profile": serialize_profile(profile)})


@app.patch("/api/profile")
@auth_required
def update_profile():
    payload = request.get_json(silent=True) or {}
    profile = get_or_create_profile(request.user_id)
    if payload.get("current_level"):
        profile.current_level = payload["current_level"]
    if payload.get("pinyin_mode") in {"always", "hover", "hidden"}:
        profile.pinyin_mode = payload["pinyin_mode"]
    if payload.get("english_mode") in {"always", "hover", "hidden"}:
        profile.english_mode = payload["english_mode"]
    if payload.get("goal"):
        profile.goal = payload["goal"][:80]
    if payload.get("daily_goal") is not None:
        profile.daily_goal = max(1, min(int(payload["daily_goal"]), 120))
    profile.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({"profile": serialize_profile(profile)})


@app.get("/api/stories")
@auth_required
def stories():
    level = request.args.get("level")
    query = Story.query
    if level:
        query = query.filter_by(level=level)
    result = [serialize_story_summary(s) for s in query.all()]
    result.sort(key=lambda item: (level_sort_key(item["level"]), item["story_number"], item["id"]))
    return jsonify({"stories": result})


@app.get("/api/stories/<int:story_id>")
@auth_required
def story(story_id: int):
    s = Story.query.get_or_404(story_id)
    progress = get_or_create_story_progress(request.user_id, story_id)
    segments = json.loads(s.content_json)
    return jsonify({
        "id": s.id,
        "title": s.title,
        **story_title_metadata(s),
        "level": s.level,
        "segments": segments,
        "sentences": build_sentences(segments),
        "progress": {
            "status": progress.status,
            "last_segment_index": progress.last_segment_index,
            "lookup_count": progress.lookup_count,
            "saved_count": progress.saved_count,
            "comprehension": normalize_story_difficulty(progress.comprehension),
            "completed_at": progress.completed_at.isoformat() if progress.completed_at else None,
        },
    })


@app.get("/api/quizzes")
@auth_required
def quizzes():
    stories_list = Story.query.all()
    stories_list.sort(key=lambda item: (level_sort_key(item.level), STORY_NUMBERS.get((item.level, item.title), item.id), item.id))
    best_attempts = {}
    for attempt in QuizAttempt.query.filter_by(user_id=request.user_id).order_by(QuizAttempt.score_percent.desc()).all():
        best_attempts.setdefault(attempt.story_id, attempt)
    attempts = QuizAttempt.query.filter_by(user_id=request.user_id).order_by(QuizAttempt.created_at.desc()).limit(12).all()
    passed_count = db.session.query(db.func.count(db.func.distinct(QuizAttempt.story_id))).filter(
        QuizAttempt.user_id == request.user_id,
        QuizAttempt.passed.is_(True),
    ).scalar() or 0
    available_count = len(stories_list)
    average_score = db.session.query(db.func.avg(QuizAttempt.score_percent)).filter(
        QuizAttempt.user_id == request.user_id,
    ).scalar() or 0
    return jsonify({
        "metrics": {
            "available_quizzes": available_count,
            "quizzes_passed": passed_count,
            "average_score": round(float(average_score)),
            "latest_attempts": len(attempts),
        },
        "stories": [
            {
                **serialize_story_summary(story_obj),
                "question_count": len(build_story_quiz(story_obj)["questions"]),
                "best_attempt": serialize_quiz_attempt(best_attempts[story_obj.id]) if story_obj.id in best_attempts else None,
            }
            for story_obj in stories_list
        ],
        "recent_attempts": [serialize_quiz_attempt(attempt) for attempt in attempts],
    })


@app.get("/api/quizzes/<int:story_id>")
@auth_required
def quiz(story_id: int):
    story_obj = Story.query.get_or_404(story_id)
    return jsonify({"quiz": public_quiz(build_story_quiz(story_obj))})


@app.post("/api/quizzes/<int:story_id>/attempts")
@auth_required
def record_quiz_attempt(story_id: int):
    story_obj = Story.query.get_or_404(story_id)
    payload = request.get_json(silent=True) or {}
    submitted_answers = payload.get("answers") or {}
    if not isinstance(submitted_answers, dict):
        return jsonify({"error": "answers must be an object"}), 400

    quiz_data = build_story_quiz(story_obj)
    question_results = []
    correct_count = 0
    for question in quiz_data["questions"]:
        submitted = submitted_answers.get(question["id"], "")
        accepted_answers = question.get("accepted_answers") or [question["answer"]]
        is_correct = any(normalize_answer(submitted) == normalize_answer(answer) for answer in accepted_answers)
        if is_correct:
            correct_count += 1
        question_results.append({
            "question_id": question["id"],
            "submitted": submitted,
            "answer": question["answer"],
            "correct": is_correct,
            "explanation": question.get("explanation", ""),
        })

    total_questions = len(quiz_data["questions"])
    score_percent = round((correct_count / total_questions) * 100) if total_questions else 0
    elapsed_seconds = max(0, int(payload.get("elapsed_seconds") or 0))
    attempt = QuizAttempt(
        user_id=request.user_id,
        story_id=story_id,
        total_questions=total_questions,
        correct_count=correct_count,
        score_percent=score_percent,
        elapsed_seconds=elapsed_seconds,
        passed=score_percent >= 97,
        answers_json=json.dumps(question_results, ensure_ascii=False),
    )
    db.session.add(attempt)
    db.session.commit()
    return jsonify({
        "attempt": serialize_quiz_attempt(attempt),
        "results": question_results,
    }), 201


@app.post("/api/stories/<int:story_id>/progress")
@auth_required
def update_story_progress(story_id: int):
    Story.query.get_or_404(story_id)
    payload = request.get_json(silent=True) or {}
    progress = get_or_create_story_progress(request.user_id, story_id)
    if payload.get("status") in {"reading", "completed"}:
        progress.status = payload["status"]
        if progress.status == "completed" and not progress.completed_at:
            progress.completed_at = datetime.utcnow()
    if payload.get("last_segment_index") is not None:
        progress.last_segment_index = max(0, int(payload["last_segment_index"]))
    difficulty_rating = normalize_story_difficulty(payload.get("comprehension"))
    if difficulty_rating:
        progress.comprehension = difficulty_rating
    progress.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({
        "progress": {
            "status": progress.status,
            "last_segment_index": progress.last_segment_index,
            "lookup_count": progress.lookup_count,
            "saved_count": progress.saved_count,
            "comprehension": normalize_story_difficulty(progress.comprehension),
            "completed_at": progress.completed_at.isoformat() if progress.completed_at else None,
        },
        "difficulty_stats": story_difficulty_stats(story_id),
    })


@app.post("/api/lookup")
@auth_required
def lookup():
    payload = request.get_json(silent=True) or {}
    text_value = payload.get("text", "").strip()
    if not text_value:
        return jsonify({"error": "Text required"}), 400

    granularity = payload.get("granularity") or heuristic_granularity(text_value)
    story_id = payload.get("story_id")
    segment_index = payload.get("segment_index")
    sentence_text = payload.get("sentence_text", "").strip()
    result = structured_lookup(text_value, granularity, sentence_text)

    db.session.add(LookupEvent(
        user_id=request.user_id,
        story_id=story_id,
        text=text_value,
        granularity=result["granularity"],
        source=result["source"],
        segment_index=segment_index,
        sentence_text=sentence_text or None,
    ))
    if story_id:
        progress = get_or_create_story_progress(request.user_id, int(story_id))
        progress.lookup_count += 1
        if segment_index is not None:
            progress.last_segment_index = max(progress.last_segment_index, int(segment_index))
    db.session.commit()

    return jsonify(result)


@app.get("/api/flashcards")
@auth_required
def list_flashcards():
    cards = Flashcard.query.filter_by(user_id=request.user_id).order_by(Flashcard.created_at.desc()).all()
    return jsonify({"flashcards": [serialize_flashcard(c) for c in cards]})


@app.post("/api/flashcards")
@auth_required
def add_flashcard():
    payload = request.get_json(silent=True) or {}
    required = ["source_text", "translation", "granularity"]
    if any(not payload.get(r) for r in required):
        return jsonify({"error": "source_text, translation, granularity are required"}), 400

    source_text = payload["source_text"].strip()
    granularity = payload["granularity"]
    story_id = payload.get("story_id")
    card = Flashcard.query.filter_by(
        user_id=request.user_id,
        source_text=source_text,
        granularity=granularity,
        story_id=story_id,
    ).first()
    status_code = 200
    if not card:
        card = Flashcard(
            user_id=request.user_id,
            story_id=story_id,
            source_text=source_text,
            pinyin=payload.get("pinyin", ""),
            translation=payload["translation"],
            granularity=granularity,
            context_sentence=payload.get("context_sentence", ""),
            due_at=datetime.utcnow(),
        )
        db.session.add(card)
        status_code = 201
    else:
        card.pinyin = payload.get("pinyin", card.pinyin)
        card.translation = payload.get("translation", card.translation)
        card.context_sentence = payload.get("context_sentence", card.context_sentence)

    if story_id:
        progress = get_or_create_story_progress(request.user_id, int(story_id))
        progress.saved_count += 1
    db.session.commit()
    return jsonify({"message": "Flashcard saved", "flashcard": serialize_flashcard(card)}), status_code


@app.delete("/api/flashcards/<int:card_id>")
@auth_required
def delete_flashcard(card_id: int):
    card = Flashcard.query.filter_by(id=card_id, user_id=request.user_id).first_or_404()
    db.session.delete(card)
    db.session.commit()
    return jsonify({"message": "Flashcard deleted"})


@app.post("/api/flashcards/<int:card_id>/review")
@auth_required
def review_flashcard(card_id: int):
    card = Flashcard.query.filter_by(id=card_id, user_id=request.user_id).first_or_404()
    payload = request.get_json(silent=True) or {}
    rating = payload.get("rating")
    if rating not in {"again", "hard", "good", "easy"}:
        return jsonify({"error": "rating must be again, hard, good, or easy"}), 400

    now = datetime.utcnow()
    mode = payload.get("mode") or payload.get("scheduler") or "standard"
    direction = payload.get("direction") or payload.get("review_direction") or leitner_practice_direction(card)
    if direction not in {"zh-en", "en-zh"}:
        return jsonify({"error": "direction must be zh-en or en-zh"}), 400
    if mode == "leitner":
        previous_due_at = card.leitner_due_at or now
        current_box = max(1, min(int(card.leitner_box or 1), 5))
        current_direction_count = direction_correct_count(card, direction)
        if rating in {"good", "easy"}:
            next_direction_count = min(DIRECTION_MASTERY_THRESHOLD, current_direction_count + (2 if rating == "easy" else 1))
        elif rating == "hard":
            next_direction_count = max(0, current_direction_count - 1)
        else:
            next_direction_count = 0
        if direction == "en-zh":
            card.en_to_zh_correct_count = next_direction_count
        else:
            card.zh_to_en_correct_count = next_direction_count

        if rating == "again":
            next_box = 1
        elif rating == "hard":
            next_box = max(1, current_box - 1)
        elif rating == "good":
            next_box = min(5, current_box + 1)
        else:
            next_box = min(5, current_box + 2)
        card.leitner_box = next_box
        card.leitner_due_at = now + timedelta(days=LEITNER_INTERVAL_DAYS[next_box])
        next_due_at = card.leitner_due_at
        card.status = "known" if direction_mastered(card, "zh-en") and direction_mastered(card, "en-zh") else "review"
    else:
        previous_due_at = card.due_at
        if rating == "again":
            card.status = "learning"
            card.interval_days = 0
            card.ease = max(1.3, card.ease - 0.2)
            card.due_at = now + timedelta(minutes=10)
        elif rating == "hard":
            card.status = "review"
            card.interval_days = max(1, card.interval_days)
            card.ease = max(1.3, card.ease - 0.15)
            card.due_at = now + timedelta(days=card.interval_days)
        elif rating == "good":
            card.status = "review"
            card.interval_days = 1 if card.interval_days == 0 else max(2, round(card.interval_days * card.ease))
            card.due_at = now + timedelta(days=card.interval_days)
        else:
            card.status = "known"
            card.ease += 0.15
            card.interval_days = 3 if card.interval_days == 0 else max(4, round(card.interval_days * card.ease))
            card.due_at = now + timedelta(days=card.interval_days)
        next_due_at = card.due_at

    card.review_count += 1
    card.last_rating = rating
    card.last_reviewed_at = now
    db.session.add(ReviewEvent(
        user_id=request.user_id,
        flashcard_id=card.id,
        rating=rating,
        previous_due_at=previous_due_at,
        next_due_at=next_due_at,
    ))
    db.session.commit()
    return jsonify({"flashcard": serialize_flashcard(card)})


@app.post("/api/flashcard-sessions")
@auth_required
def record_flashcard_session():
    payload = request.get_json(silent=True) or {}
    total_cards = max(0, int(payload.get("total_cards") or 0))
    correct_count = max(0, int(payload.get("correct_count") or 0))
    incorrect_count = max(0, int(payload.get("incorrect_count") or 0))
    if total_cards == 0:
        return jsonify({"error": "total_cards must be greater than 0"}), 400
    score_percent = round((correct_count / total_cards) * 100)
    rating_breakdown = payload.get("rating_breakdown") or {}
    if not isinstance(rating_breakdown, dict):
        rating_breakdown = {}

    session = FlashcardPracticeSession(
        user_id=request.user_id,
        practice_filter=str(payload.get("practice_filter") or "all")[:40],
        total_cards=total_cards,
        correct_count=min(correct_count, total_cards),
        incorrect_count=min(incorrect_count, total_cards),
        score_percent=max(0, min(score_percent, 100)),
        rating_breakdown_json=json.dumps(rating_breakdown),
    )
    db.session.add(session)
    db.session.commit()
    return jsonify({"session": serialize_practice_session(session)}), 201


@app.get("/api/review/due")
@auth_required
def due_review():
    now = datetime.utcnow()
    cards = Flashcard.query.filter(
        Flashcard.user_id == request.user_id,
        Flashcard.due_at <= now,
    ).order_by(Flashcard.due_at.asc()).all()
    return jsonify({"flashcards": [serialize_flashcard(card) for card in cards]})


@app.get("/api/progress/summary")
@auth_required
def progress_summary():
    total_cards = Flashcard.query.filter_by(user_id=request.user_id).count()
    due_cards = Flashcard.query.filter(Flashcard.user_id == request.user_id, Flashcard.due_at <= datetime.utcnow()).count()
    known_cards = Flashcard.query.filter_by(user_id=request.user_id, status="known").count()
    completed_stories = StoryProgress.query.filter_by(user_id=request.user_id, status="completed").count()
    lookup_count = LookupEvent.query.filter_by(user_id=request.user_id).count()
    quizzes_passed = db.session.query(db.func.count(db.func.distinct(QuizAttempt.story_id))).filter(
        QuizAttempt.user_id == request.user_id,
        QuizAttempt.passed.is_(True),
    ).scalar() or 0
    return jsonify({
        "summary": {
            "total_cards": total_cards,
            "due_cards": due_cards,
            "known_cards": known_cards,
            "completed_stories": completed_stories,
            "lookup_count": lookup_count,
            "quiz_level_complete": quizzes_passed,
        }
    })


def seg(hanzi, pinyin, english):
    return {"hanzi": hanzi, "pinyin": pinyin, "english": english}


COMMA = seg("，", "", ",")
PERIOD = seg("。", "", ".")


SEED_STORIES = [
    {
        "title": "公园里的早晨",
        "level": "beginner",
        "segments": [
            seg("今天", "jīn tiān", "today"), seg("早上", "zǎo shang", "morning"), COMMA,
            seg("我", "wǒ", "I"), seg("在", "zài", "am at"), seg("公园", "gōng yuán", "park"), seg("散步", "sàn bù", "walk"), PERIOD,
            seg("我", "wǒ", "I"), seg("看到", "kàn dào", "see"), seg("一只", "yì zhī", "one (animal)"), seg("猫", "māo", "cat"), PERIOD,
        ],
    },
    {
        "title": "一起喝茶",
        "level": "intermediate",
        "segments": [
            seg("下午", "xià wǔ", "afternoon"), COMMA,
            seg("我", "wǒ", "I"), seg("和", "hé", "and"), seg("朋友", "péng you", "friend"), seg("在", "zài", "at"), seg("小店", "xiǎo diàn", "small shop"), seg("聊天", "liáo tiān", "chat"), PERIOD,
            seg("我们", "wǒ men", "we"), seg("一起", "yì qǐ", "together"), seg("喝", "hē", "drink"), seg("热茶", "rè chá", "hot tea"), PERIOD,
        ],
    },
    {
        "title": "我的书包",
        "level": "beginner",
        "segments": [
            seg("我", "wǒ", "I"), seg("有", "yǒu", "have"), seg("一个", "yí gè", "one"), seg("蓝色", "lán sè", "blue"), seg("书包", "shū bāo", "school bag"), PERIOD,
            seg("书包", "shū bāo", "school bag"), seg("里", "lǐ", "inside"), seg("有", "yǒu", "has"), seg("书", "shū", "books"), seg("和", "hé", "and"), seg("铅笔", "qiān bǐ", "pencils"), PERIOD,
        ],
    },
    {
        "title": "下雨天",
        "level": "beginner",
        "segments": [
            seg("今天", "jīn tiān", "today"), seg("下雨", "xià yǔ", "rains"), PERIOD,
            seg("我", "wǒ", "I"), seg("带", "dài", "bring"), seg("一把", "yì bǎ", "one"), seg("伞", "sǎn", "umbrella"), seg("去", "qù", "go"), seg("学校", "xué xiào", "school"), PERIOD,
            seg("路上", "lù shang", "on the road"), seg("很", "hěn", "very"), seg("安静", "ān jìng", "quiet"), PERIOD,
        ],
    },
    {
        "title": "妈妈做饭",
        "level": "beginner",
        "segments": [
            seg("晚上", "wǎn shang", "evening"), COMMA,
            seg("妈妈", "mā ma", "mom"), seg("做", "zuò", "makes"), seg("米饭", "mǐ fàn", "rice"), seg("和", "hé", "and"), seg("青菜", "qīng cài", "greens"), PERIOD,
            seg("我", "wǒ", "I"), seg("帮", "bāng", "help"), seg("她", "tā", "her"), seg("拿", "ná", "carry"), seg("碗", "wǎn", "bowls"), PERIOD,
        ],
    },
    {
        "title": "小狗找球",
        "level": "beginner",
        "segments": [
            seg("小狗", "xiǎo gǒu", "puppy"), seg("有", "yǒu", "has"), seg("一个", "yí gè", "one"), seg("红球", "hóng qiú", "red ball"), PERIOD,
            seg("球", "qiú", "ball"), seg("不见了", "bú jiàn le", "is gone"), PERIOD,
            seg("小狗", "xiǎo gǒu", "puppy"), seg("在", "zài", "in"), seg("桌子", "zhuō zi", "table"), seg("下面", "xià mian", "under"), seg("找到", "zhǎo dào", "finds"), seg("球", "qiú", "ball"), PERIOD,
        ],
    },
    {
        "title": "周末去市场",
        "level": "beginner",
        "segments": [
            seg("周末", "zhōu mò", "weekend"), COMMA,
            seg("我", "wǒ", "I"), seg("和", "hé", "and"), seg("爸爸", "bà ba", "dad"), seg("去", "qù", "go"), seg("市场", "shì chǎng", "market"), PERIOD,
            seg("我们", "wǒ men", "we"), seg("买", "mǎi", "buy"), seg("苹果", "píng guǒ", "apples"), seg("和", "hé", "and"), seg("面包", "miàn bāo", "bread"), PERIOD,
        ],
    },
    {
        "title": "邻居的菜园",
        "level": "intermediate",
        "segments": [
            seg("邻居", "lín jū", "neighbor"), seg("在", "zài", "in"), seg("楼下", "lóu xià", "downstairs"), seg("种", "zhòng", "plants"), seg("了", "le", "completed action"), seg("一个", "yí gè", "one"), seg("小菜园", "xiǎo cài yuán", "small vegetable garden"), PERIOD,
            seg("每天", "měi tiān", "every day"), seg("傍晚", "bàng wǎn", "evening"), COMMA,
            seg("她", "tā", "she"), seg("都会", "dōu huì", "always will"), seg("给", "gěi", "for"), seg("番茄", "fān qié", "tomatoes"), seg("浇水", "jiāo shuǐ", "water"), PERIOD,
        ],
    },
    {
        "title": "迟到的公交车",
        "level": "intermediate",
        "segments": [
            seg("早高峰", "zǎo gāo fēng", "morning rush hour"), COMMA,
            seg("公交车", "gōng jiāo chē", "bus"), seg("迟到", "chí dào", "is late"), seg("了", "le", "completed action"), seg("十分钟", "shí fēn zhōng", "ten minutes"), PERIOD,
            seg("车站", "chē zhàn", "bus stop"), seg("的人", "de rén", "people"), seg("越来越多", "yuè lái yuè duō", "more and more"), COMMA,
            seg("可是", "kě shì", "but"), seg("大家", "dà jiā", "everyone"), seg("都", "dōu", "all"), seg("很", "hěn", "very"), seg("耐心", "nài xīn", "patient"), PERIOD,
        ],
    },
    {
        "title": "图书馆的座位",
        "level": "intermediate",
        "segments": [
            seg("考试", "kǎo shì", "exam"), seg("前", "qián", "before"), COMMA,
            seg("图书馆", "tú shū guǎn", "library"), seg("总是", "zǒng shì", "always"), seg("很", "hěn", "very"), seg("满", "mǎn", "full"), PERIOD,
            seg("李明", "Lǐ Míng", "Li Ming"), seg("提前", "tí qián", "ahead of time"), seg("半小时", "bàn xiǎo shí", "half an hour"), seg("到", "dào", "arrives"), COMMA,
            seg("终于", "zhōng yú", "finally"), seg("找到", "zhǎo dào", "finds"), seg("一个", "yí gè", "one"), seg("安静", "ān jìng", "quiet"), seg("的", "de", "modifier marker"), seg("座位", "zuò wèi", "seat"), PERIOD,
        ],
    },
    {
        "title": "第一次做采访",
        "level": "intermediate",
        "segments": [
            seg("小王", "Xiǎo Wáng", "Xiao Wang"), seg("第一次", "dì yī cì", "first time"), seg("做", "zuò", "do"), seg("采访", "cǎi fǎng", "interview"), COMMA,
            seg("心里", "xīn lǐ", "inside"), seg("有点", "yǒu diǎn", "a little"), seg("紧张", "jǐn zhāng", "nervous"), PERIOD,
            seg("他", "tā", "he"), seg("先", "xiān", "first"), seg("准备", "zhǔn bèi", "prepares"), seg("问题", "wèn tí", "questions"), COMMA,
            seg("然后", "rán hòu", "then"), seg("认真", "rèn zhēn", "carefully"), seg("听", "tīng", "listens"), seg("对方", "duì fāng", "the other person"), seg("回答", "huí dá", "answer"), PERIOD,
        ],
    },
    {
        "title": "城市里的老树",
        "level": "intermediate",
        "segments": [
            seg("街角", "jiē jiǎo", "street corner"), seg("有", "yǒu", "has"), seg("一棵", "yì kē", "one"), seg("老树", "lǎo shù", "old tree"), PERIOD,
            seg("虽然", "suī rán", "although"), seg("周围", "zhōu wéi", "around"), seg("盖", "gài", "build"), seg("了", "le", "completed action"), seg("很多", "hěn duō", "many"), seg("高楼", "gāo lóu", "tall buildings"), COMMA,
            seg("它", "tā", "it"), seg("仍然", "réng rán", "still"), seg("给", "gěi", "give"), seg("行人", "xíng rén", "pedestrians"), seg("一片", "yí piàn", "a patch of"), seg("阴凉", "yīn liáng", "shade"), PERIOD,
        ],
    },
    {
        "title": "夜航之后",
        "level": "advanced",
        "segments": [
            seg("凌晨", "líng chén", "early dawn"), COMMA,
            seg("飞机", "fēi jī", "airplane"), seg("穿过", "chuān guò", "passes through"), seg("厚厚的", "hòu hòu de", "thick"), seg("云层", "yún céng", "cloud layer"), COMMA,
            seg("缓缓", "huǎn huǎn", "slowly"), seg("降落", "jiàng luò", "lands"), seg("在", "zài", "at"), seg("陌生", "mò shēng", "unfamiliar"), seg("的", "de", "modifier marker"), seg("城市", "chéng shì", "city"), PERIOD,
            seg("旅客", "lǚ kè", "travelers"), seg("们", "men", "plural marker"), seg("拖着", "tuō zhe", "dragging"), seg("行李", "xíng lǐ", "luggage"), COMMA,
            seg("脸上", "liǎn shang", "on faces"), seg("带着", "dài zhe", "carrying"), seg("疲惫", "pí bèi", "fatigue"), seg("和", "hé", "and"), seg("期待", "qī dài", "expectation"), PERIOD,
        ],
    },
    {
        "title": "旧巷的新咖啡馆",
        "level": "advanced",
        "segments": [
            seg("老城区", "lǎo chéng qū", "old district"), seg("的", "de", "modifier marker"), seg("巷子", "xiàng zi", "alley"), seg("很窄", "hěn zhǎi", "is narrow"), COMMA,
            seg("墙上", "qiáng shang", "on the wall"), seg("还", "hái", "still"), seg("留着", "liú zhe", "retains"), seg("斑驳", "bān bó", "mottled"), seg("的", "de", "modifier marker"), seg("门牌", "mén pái", "doorplates"), PERIOD,
            seg("最近", "zuì jìn", "recently"), COMMA,
            seg("一家", "yì jiā", "one"), seg("咖啡馆", "kā fēi guǎn", "cafe"), seg("开", "kāi", "opened"), seg("在", "zài", "in"), seg("这里", "zhè lǐ", "here"), COMMA,
            seg("年轻人", "nián qīng rén", "young people"), seg("和", "hé", "and"), seg("老邻居", "lǎo lín jū", "old neighbors"), seg("都", "dōu", "all"), seg("常来", "cháng lái", "often come"), PERIOD,
        ],
    },
    {
        "title": "一封没有寄出的信",
        "level": "advanced",
        "segments": [
            seg("抽屉", "chōu ti", "drawer"), seg("深处", "shēn chù", "deep place"), seg("放着", "fàng zhe", "holds"), seg("一封", "yì fēng", "one"), seg("没有", "méi yǒu", "not"), seg("寄出", "jì chū", "sent"), seg("的", "de", "modifier marker"), seg("信", "xìn", "letter"), PERIOD,
            seg("纸", "zhǐ", "paper"), seg("已经", "yǐ jīng", "already"), seg("微微", "wēi wēi", "slightly"), seg("发黄", "fā huáng", "yellowed"), COMMA,
            seg("可是", "kě shì", "but"), seg("每一行", "měi yì háng", "every line"), seg("字", "zì", "characters"), seg("仍然", "réng rán", "still"), seg("清楚", "qīng chǔ", "clear"), PERIOD,
        ],
    },
    {
        "title": "河边的辩论",
        "level": "advanced",
        "segments": [
            seg("晚饭后", "wǎn fàn hòu", "after dinner"), COMMA,
            seg("两位", "liǎng wèi", "two"), seg("朋友", "péng you", "friends"), seg("沿着", "yán zhe", "along"), seg("河边", "hé biān", "riverside"), seg("散步", "sàn bù", "walk"), PERIOD,
            seg("他们", "tā men", "they"), seg("讨论", "tǎo lùn", "discuss"), seg("城市", "chéng shì", "city"), seg("发展", "fā zhǎn", "development"), seg("和", "hé", "and"), seg("环境", "huán jìng", "environment"), seg("保护", "bǎo hù", "protection"), COMMA,
            seg("语气", "yǔ qì", "tone"), seg("激烈", "jī liè", "intense"), COMMA,
            seg("但", "dàn", "but"), seg("彼此", "bǐ cǐ", "each other"), seg("尊重", "zūn zhòng", "respect"), PERIOD,
        ],
    },
    {
        "title": "博物馆里的修复师",
        "level": "advanced",
        "segments": [
            seg("博物馆", "bó wù guǎn", "museum"), seg("闭馆", "bì guǎn", "closed"), seg("以后", "yǐ hòu", "after"), COMMA,
            seg("修复师", "xiū fù shī", "restorer"), seg("还", "hái", "still"), seg("坐在", "zuò zài", "sits at"), seg("灯下", "dēng xià", "under the lamp"), PERIOD,
            seg("她", "tā", "she"), seg("用", "yòng", "uses"), seg("细小", "xì xiǎo", "tiny"), seg("的", "de", "modifier marker"), seg("刷子", "shuā zi", "brush"), seg("清理", "qīng lǐ", "cleans"), seg("陶片", "táo piàn", "pottery shard"), COMMA,
            seg("仿佛", "fǎng fú", "as if"), seg("在", "zài", "in"), seg("和", "hé", "with"), seg("几百年前", "jǐ bǎi nián qián", "hundreds of years ago"), seg("的", "de", "modifier marker"), seg("工匠", "gōng jiàng", "craftsperson"), seg("对话", "duì huà", "converse"), PERIOD,
        ],
    },
]


NATURAL_SENTENCE_TRANSLATIONS = {
    "今天早上，我在公园散步。": "This morning, I am taking a walk in the park.",
    "我看到一只猫。": "I see a cat.",
    "下午，我和朋友在小店聊天。": "In the afternoon, my friend and I chat in a small shop.",
    "我们一起喝热茶。": "We drink hot tea together.",
    "我有一个蓝色书包。": "I have a blue school bag.",
    "书包里有书和铅笔。": "There are books and pencils in the school bag.",
    "今天下雨。": "It is raining today.",
    "我带一把伞去学校。": "I bring an umbrella to school.",
    "路上很安静。": "The road is very quiet.",
    "晚上，妈妈做米饭和青菜。": "In the evening, Mom makes rice and greens.",
    "我帮她拿碗。": "I help her carry the bowls.",
    "小狗有一个红球。": "The puppy has a red ball.",
    "球不见了。": "The ball is gone.",
    "小狗在桌子下面找到球。": "The puppy finds the ball under the table.",
    "周末，我和爸爸去市场。": "On the weekend, Dad and I go to the market.",
    "我们买苹果和面包。": "We buy apples and bread.",
    "邻居在楼下种了一个小菜园。": "The neighbor planted a small vegetable garden downstairs.",
    "每天傍晚，她都会给番茄浇水。": "Every evening, she waters the tomatoes.",
    "早高峰，公交车迟到了十分钟。": "During morning rush hour, the bus was ten minutes late.",
    "车站的人越来越多，可是大家都很耐心。": "More and more people gathered at the stop, but everyone was patient.",
    "考试前，图书馆总是很满。": "Before exams, the library is always full.",
    "李明提前半小时到，终于找到一个安静的座位。": "Li Ming arrives half an hour early and finally finds a quiet seat.",
    "小王第一次做采访，心里有点紧张。": "Xiao Wang is doing an interview for the first time and feels a little nervous.",
    "他先准备问题，然后认真听对方回答。": "He prepares questions first, then carefully listens to the other person's answers.",
    "街角有一棵老树。": "There is an old tree on the street corner.",
    "虽然周围盖了很多高楼，它仍然给行人一片阴凉。": "Although many tall buildings have gone up around it, it still gives pedestrians shade.",
    "凌晨，飞机穿过厚厚的云层，缓缓降落在陌生的城市。": "At dawn, the plane passes through thick clouds and slowly lands in an unfamiliar city.",
    "旅客们拖着行李，脸上带着疲惫和期待。": "The travelers drag their luggage, their faces showing both fatigue and anticipation.",
    "老城区的巷子很窄，墙上还留着斑驳的门牌。": "The alleys in the old district are narrow, and mottled doorplates still remain on the walls.",
    "最近，一家咖啡馆开在这里，年轻人和老邻居都常来。": "Recently, a cafe opened here, and both young people and longtime neighbors often come by.",
    "抽屉深处放着一封没有寄出的信。": "Deep in the drawer lies a letter that was never sent.",
    "纸已经微微发黄，可是每一行字仍然清楚。": "The paper has yellowed slightly, but every line is still clear.",
    "晚饭后，两位朋友沿着河边散步。": "After dinner, two friends walk along the river.",
    "他们讨论城市发展和环境保护，语气激烈，但彼此尊重。": "They discuss urban development and environmental protection intensely, but still respect each other.",
    "博物馆闭馆以后，修复师还坐在灯下。": "After the museum closes, the restorer is still sitting under the lamp.",
    "她用细小的刷子清理陶片，仿佛在和几百年前的工匠对话。": "She cleans the pottery shard with a tiny brush, as if conversing with a craftsperson from hundreds of years ago.",
}


def build_literal_sentence_translations():
    translations = {}
    for story in SEED_STORIES:
        current = []
        for segment in story["segments"]:
            current.append(segment)
            if segment.get("hanzi") in {"。", "！", "？", "!", "?"}:
                hanzi = "".join(item.get("hanzi", "") for item in current)
                translations[hanzi] = literal_translation_from_segments(current)
                current = []
        if current:
            hanzi = "".join(item.get("hanzi", "") for item in current)
            translations[hanzi] = literal_translation_from_segments(current)
    return translations


LITERAL_SENTENCE_TRANSLATIONS = build_literal_sentence_translations()


TITLE_METADATA = {
    "公园里的早晨": {"pinyin": "gōng yuán lǐ de zǎo chén", "english": "Morning in the Park"},
    "我的书包": {"pinyin": "wǒ de shū bāo", "english": "My School Bag"},
    "下雨天": {"pinyin": "xià yǔ tiān", "english": "A Rainy Day"},
    "妈妈做饭": {"pinyin": "mā ma zuò fàn", "english": "Mom Makes Dinner"},
    "小狗找球": {"pinyin": "xiǎo gǒu zhǎo qiú", "english": "The Puppy Finds the Ball"},
    "周末去市场": {"pinyin": "zhōu mò qù shì chǎng", "english": "Going to the Market on the Weekend"},
    "一起喝茶": {"pinyin": "yì qǐ hē chá", "english": "Drinking Tea Together"},
    "邻居的菜园": {"pinyin": "lín jū de cài yuán", "english": "The Neighbor's Vegetable Garden"},
    "迟到的公交车": {"pinyin": "chí dào de gōng jiāo chē", "english": "The Late Bus"},
    "图书馆的座位": {"pinyin": "tú shū guǎn de zuò wèi", "english": "A Seat in the Library"},
    "第一次做采访": {"pinyin": "dì yī cì zuò cǎi fǎng", "english": "The First Interview"},
    "城市里的老树": {"pinyin": "chéng shì lǐ de lǎo shù", "english": "The Old Tree in the City"},
    "夜航之后": {"pinyin": "yè háng zhī hòu", "english": "After the Night Flight"},
    "旧巷的新咖啡馆": {"pinyin": "jiù xiàng de xīn kā fēi guǎn", "english": "The New Cafe in the Old Alley"},
    "一封没有寄出的信": {"pinyin": "yì fēng méi yǒu jì chū de xìn", "english": "A Letter Never Sent"},
    "河边的辩论": {"pinyin": "hé biān de biàn lùn", "english": "A Debate by the River"},
    "博物馆里的修复师": {"pinyin": "bó wù guǎn lǐ de xiū fù shī", "english": "The Restorer in the Museum"},
}


def level_sort_key(level: str) -> int:
    try:
        return LEVEL_ORDER.index(level)
    except ValueError:
        return len(LEVEL_ORDER)


def story_number_map():
    counters = {}
    mapping = {}
    for item in SEED_STORIES:
        level = item["level"]
        counters[level] = counters.get(level, 0) + 1
        mapping[(level, item["title"])] = counters[level]
    return mapping


STORY_NUMBERS = story_number_map()


DIFFICULTY_LABELS = {
    "hard": "Hard",
    "medium": "Medium",
    "easy": "Easy",
}
DIFFICULTY_ALIASES = {
    "low": "hard",
    "medium": "medium",
    "high": "easy",
    "hard": "hard",
    "easy": "easy",
}
DIFFICULTY_WEIGHTS = {
    "hard": 0,
    "medium": 1,
    "easy": 2,
}


def normalize_story_difficulty(value: str) -> Optional[str]:
    return DIFFICULTY_ALIASES.get(str(value or "").lower())


def story_difficulty_stats(story_id: int):
    counts = {"hard": 0, "medium": 0, "easy": 0}
    for progress in StoryProgress.query.filter_by(story_id=story_id).all():
        rating = normalize_story_difficulty(progress.comprehension)
        if rating:
            counts[rating] += 1
    total = sum(counts.values())
    percentages = {
        key: round((value / total) * 100) if total else 0
        for key, value in counts.items()
    }
    if total:
        score = sum(counts[key] * DIFFICULTY_WEIGHTS[key] for key in counts) / total
        difficulty = "hard" if score < 0.75 else "medium" if score < 1.5 else "easy"
    else:
        difficulty = None
    return {
        "difficulty": difficulty,
        "difficulty_label": DIFFICULTY_LABELS.get(difficulty, "Unrated"),
        "total_ratings": total,
        "counts": counts,
        "percentages": percentages,
    }


def story_title_metadata(story_obj: Story):
    number = STORY_NUMBERS.get((story_obj.level, story_obj.title), story_obj.id)
    metadata = TITLE_METADATA.get(story_obj.title, {})
    difficulty = story_difficulty_stats(story_obj.id)
    return {
        "story_number": number,
        "title_pinyin": metadata.get("pinyin", ""),
        "title_english": metadata.get("english", ""),
        "display_title": f"{number}. {story_obj.title}",
        "difficulty": difficulty["difficulty"],
        "difficulty_label": difficulty["difficulty_label"],
        "difficulty_stats": difficulty,
    }


def serialize_story_summary(story_obj: Story):
    return {
        "id": story_obj.id,
        "title": story_obj.title,
        "level": story_obj.level,
        **story_title_metadata(story_obj),
    }


def hydrate_story_dictionary():
    for story in SEED_STORIES:
        for item in story["segments"]:
            text_value = item["hanzi"]
            if not item["pinyin"] or text_value in {"，", "。", "！", "？"}:
                continue
            LOCAL_DICTIONARY.setdefault(text_value, {
                "translation": item["english"],
                "pinyin": item["pinyin"],
                "granularity": heuristic_granularity(text_value),
            })


hydrate_story_dictionary()


def seed_if_empty():
    for item in SEED_STORIES:
        existing = Story.query.filter_by(title=item["title"], level=item["level"]).first()
        content_json = json.dumps(item["segments"], ensure_ascii=False)
        if existing:
            existing.content_json = content_json
        else:
            db.session.add(Story(title=item["title"], level=item["level"], content_json=content_json))
    db.session.commit()


def ensure_sqlite_dev_schema():
    if not str(app.config["SQLALCHEMY_DATABASE_URI"]).startswith("sqlite"):
        return

    def existing_columns(table_name):
        rows = db.session.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
        return {row[1] for row in rows}

    profile_columns = existing_columns("user_profile")
    profile_additions = {
        "english_mode": "VARCHAR(20) DEFAULT 'hidden' NOT NULL",
    }
    for column, ddl in profile_additions.items():
        if column not in profile_columns:
            db.session.execute(text(f"ALTER TABLE user_profile ADD COLUMN {column} {ddl}"))

    flashcard_columns = existing_columns("flashcard")
    additions = {
        "story_id": "INTEGER",
        "context_sentence": "TEXT",
        "status": "VARCHAR(20) DEFAULT 'new' NOT NULL",
        "last_rating": "VARCHAR(20)",
        "leitner_box": "INTEGER DEFAULT 1 NOT NULL",
        "leitner_due_at": "DATETIME",
        "due_at": "DATETIME",
        "interval_days": "INTEGER DEFAULT 0 NOT NULL",
        "ease": "FLOAT DEFAULT 2.5 NOT NULL",
        "review_count": "INTEGER DEFAULT 0 NOT NULL",
        "zh_to_en_correct_count": "INTEGER DEFAULT 0 NOT NULL",
        "en_to_zh_correct_count": "INTEGER DEFAULT 0 NOT NULL",
        "last_reviewed_at": "DATETIME",
    }
    for column, ddl in additions.items():
        if column not in flashcard_columns:
            db.session.execute(text(f"ALTER TABLE flashcard ADD COLUMN {column} {ddl}"))

    db.session.execute(text("UPDATE flashcard SET status = 'new' WHERE status IS NULL"))
    db.session.execute(text("UPDATE flashcard SET interval_days = 0 WHERE interval_days IS NULL"))
    db.session.execute(text("UPDATE flashcard SET ease = 2.5 WHERE ease IS NULL"))
    db.session.execute(text("UPDATE flashcard SET review_count = 0 WHERE review_count IS NULL"))
    db.session.execute(text("UPDATE flashcard SET zh_to_en_correct_count = 0 WHERE zh_to_en_correct_count IS NULL"))
    db.session.execute(text("UPDATE flashcard SET en_to_zh_correct_count = 0 WHERE en_to_zh_correct_count IS NULL"))
    db.session.execute(text("UPDATE flashcard SET due_at = created_at WHERE due_at IS NULL"))
    db.session.execute(text("UPDATE flashcard SET leitner_box = 1 WHERE leitner_box IS NULL"))
    db.session.execute(text("UPDATE flashcard SET leitner_due_at = COALESCE(due_at, created_at) WHERE leitner_due_at IS NULL"))
    db.session.execute(text("UPDATE user_profile SET english_mode = 'hidden' WHERE english_mode IS NULL"))
    db.session.commit()


@app.cli.command("init-db")
def init_db_cmd():
    db.create_all()
    ensure_sqlite_dev_schema()
    seed_if_empty()
    print("Database initialized")


if __name__ == "__main__":
    with app.app_context():
        db.create_all()
        ensure_sqlite_dev_schema()
        seed_if_empty()
    port = int(os.getenv("PORT", "5001"))
    app.run(host="0.0.0.0", port=port, debug=True)
