import { useEffect, useMemo, useState } from 'react'

const api = async (path, method = 'GET', token, body) => {
  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  })

  const raw = await response.text()
  let data = {}
  if (raw) {
    try {
      data = JSON.parse(raw)
    } catch {
      throw new Error(`Server returned non-JSON response (${response.status})`)
    }
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`)
  }
  return data
}

const classifySelection = (text) => {
  const clean = text.replace(/\s/g, '')
  if (clean.length <= 1) return 'character'
  if (clean.length <= 3) return 'word'
  if (clean.length <= 9) return 'phrase'
  if (clean.length <= 20) return 'clause'
  return 'sentence'
}

export default function App() {
  const [mode, setMode] = useState('login')
  const [credentials, setCredentials] = useState({ username: '', password: '' })
  const [token, setToken] = useState(localStorage.getItem('token') || '')
  const [username, setUsername] = useState(localStorage.getItem('username') || '')
  const [levels, setLevels] = useState([])
  const [selectedLevel, setSelectedLevel] = useState('')
  const [stories, setStories] = useState([])
  const [selectedStoryId, setSelectedStoryId] = useState(null)
  const [story, setStory] = useState(null)
  const [bubble, setBubble] = useState(null)
  const [selectedRange, setSelectedRange] = useState(null)
  const [flashcards, setFlashcards] = useState([])
  const [view, setView] = useState('reader')
  const [practiceFilter, setPracticeFilter] = useState('all')
  const [practiceIndex, setPracticeIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [learnedByCardId, setLearnedByCardId] = useState({})
  const [error, setError] = useState('')

  const storyPlainText = useMemo(
    () => (story ? story.segments.map((s) => s.hanzi).join('') : ''),
    [story]
  )

  const learnedStorageKey = useMemo(() => `learnedFlashcards:${username || 'anon'}`, [username])

  useEffect(() => {
    const saved = localStorage.getItem(learnedStorageKey)
    setLearnedByCardId(saved ? JSON.parse(saved) : {})
  }, [learnedStorageKey])

  useEffect(() => {
    localStorage.setItem(learnedStorageKey, JSON.stringify(learnedByCardId))
  }, [learnedByCardId, learnedStorageKey])

  const segmentRanges = useMemo(() => {
    if (!story) return []
    let cursor = 0
    return story.segments.map((segment) => {
      const start = cursor
      cursor += segment.hanzi.length
      return { start, end: cursor }
    })
  }, [story])

  const practiceDeck = useMemo(() => {
    if (practiceFilter === 'unknown') {
      return flashcards.filter((card) => !learnedByCardId[card.id])
    }
    return flashcards
  }, [flashcards, practiceFilter, learnedByCardId])

  const activePracticeCard = practiceDeck[practiceIndex] || null

  useEffect(() => {
    if (practiceIndex > 0 && practiceIndex >= practiceDeck.length) {
      setPracticeIndex(Math.max(practiceDeck.length - 1, 0))
    }
    setShowAnswer(false)
  }, [practiceDeck.length, practiceIndex])

  const isSegmentHighlighted = (index) => {
    if (!selectedRange) return false
    const range = segmentRanges[index]
    if (!range) return false
    return range.start < selectedRange.end && range.end > selectedRange.start
  }

  const selectText = async (selectedText, rect, range) => {
    if (!selectedText) return
    const granularity = classifySelection(selectedText)

    try {
      const data = await api('/api/lookup', 'POST', token, { text: selectedText, granularity })
      const anchorX = window.scrollX + ((rect?.left || 100) + ((rect?.width || 0) / 2))
      const minX = window.scrollX + 40
      const maxX = window.scrollX + window.innerWidth - 40
      const clampedX = Math.min(maxX, Math.max(minX, anchorX))

      setBubble({
        ...data,
        x: clampedX,
        y: window.scrollY + (rect?.bottom || 220) + 14
      })
      setSelectedRange(range)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    if (!token) return
    ;(async () => {
      try {
        const levelData = await api('/api/levels', 'GET', token)
        setLevels(levelData.levels)
        const cardData = await api('/api/flashcards', 'GET', token)
        setFlashcards(cardData.flashcards)
      } catch (err) {
        setError(err.message)
      }
    })()
  }, [token])

  useEffect(() => {
    if (!token || !selectedLevel) return
    ;(async () => {
      try {
        const data = await api(`/api/stories?level=${selectedLevel}`, 'GET', token)
        setStories(data.stories)
      } catch (err) {
        setError(err.message)
      }
    })()
  }, [selectedLevel, token])

  useEffect(() => {
    if (!selectedStoryId || !token) return
    ;(async () => {
      try {
        const data = await api(`/api/stories/${selectedStoryId}`, 'GET', token)
        setStory(data)
        setBubble(null)
        setSelectedRange(null)
      } catch (err) {
        setError(err.message)
      }
    })()
  }, [selectedStoryId, token])

  const authenticate = async () => {
    setError('')
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const data = await api(path, 'POST', null, credentials)
      setToken(data.token)
      setUsername(data.username)
      localStorage.setItem('token', data.token)
      localStorage.setItem('username', data.username)
    } catch (err) {
      setError(err.message)
    }
  }

  const handleMouseUp = async () => {
    if (!story) return
    const selection = window.getSelection()
    const selectedText = selection.toString().trim()
    if (!selectedText) return

    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    const rect = range?.getBoundingClientRect()
    const start = storyPlainText.indexOf(selectedText)
    const resolvedRange = start >= 0
      ? { start, end: start + selectedText.length }
      : null

    await selectText(selectedText, rect, resolvedRange)
  }

  const handleSegmentClick = async (segment, index, event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const range = segmentRanges[index]
    await selectText(segment.hanzi, rect, range)
  }

  const addFlashcard = async () => {
    if (!bubble) return
    try {
      await api('/api/flashcards', 'POST', token, {
        source_text: bubble.text,
        pinyin: bubble.pinyin,
        translation: bubble.translation,
        granularity: bubble.granularity
      })
      const cardData = await api('/api/flashcards', 'GET', token)
      setFlashcards(cardData.flashcards)
    } catch (err) {
      setError(err.message)
    }
  }

  const speakText = (text, lang = 'zh-CN') => {
    if (!window.speechSynthesis) return
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang
    window.speechSynthesis.speak(utterance)
  }

  const markCardLearned = (cardId, learned) => {
    setLearnedByCardId((prev) => ({ ...prev, [cardId]: learned }))
  }

  const nextPracticeCard = () => {
    if (practiceDeck.length <= 1) return
    setPracticeIndex((i) => (i + 1) % practiceDeck.length)
    setShowAnswer(false)
  }

  const previousPracticeCard = () => {
    if (practiceDeck.length <= 1) return
    setPracticeIndex((i) => (i - 1 + practiceDeck.length) % practiceDeck.length)
    setShowAnswer(false)
  }

  const logout = () => {
    setToken('')
    localStorage.removeItem('token')
    localStorage.removeItem('username')
    setStory(null)
    setSelectedStoryId(null)
    setStories([])
    setLevels([])
    setFlashcards([])
    setBubble(null)
    setSelectedRange(null)
    setView('reader')
  }

  if (!token) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>Mandarin Story Coach</h1>
          <p>Read Chinese stories with pinyin, smart lookups, and speech support.</p>
          <div className="auth-toggle">
            <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Log In</button>
            <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Create User</button>
          </div>
          <input
            placeholder="Username"
            value={credentials.username}
            onChange={(e) => setCredentials((c) => ({ ...c, username: e.target.value }))}
          />
          <input
            type="password"
            placeholder="Password"
            value={credentials.password}
            onChange={(e) => setCredentials((c) => ({ ...c, password: e.target.value }))}
          />
          <button onClick={authenticate}>{mode === 'login' ? 'Log In' : 'Sign Up'}</button>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header>
        <h1>Welcome, {username}</h1>
        <button onClick={logout}>Logout</button>
      </header>

      <nav className="top-nav">
        <button className={view === 'reader' ? 'active' : ''} onClick={() => setView('reader')}>Story Reader</button>
        <button className={view === 'practice' ? 'active' : ''} onClick={() => setView('practice')}>Flashcard Practice Mode</button>
      </nav>

      {view === 'reader' && (
        <>
          <section className="control-row">
            <label>
              Reading level
              <select value={selectedLevel} onChange={(e) => setSelectedLevel(e.target.value)}>
                <option value="">Select level</option>
                {levels.map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </label>

            <label>
              Story
              <select value={selectedStoryId || ''} onChange={(e) => setSelectedStoryId(Number(e.target.value))}>
                <option value="">Select story</option>
                {stories.map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            </label>
          </section>

          {story && (
            <section className="reader" onMouseUp={handleMouseUp}>
              <div className="reader-header">
                <h2>{story.title}</h2>
                <button onClick={() => speakText(storyPlainText)}>🔊 Listen to full story</button>
              </div>
              <article className="story-grid">
                {story.segments.map((segment, index) => (
                  <span key={`${segment.hanzi}-${index}`} className={`segment ${isSegmentHighlighted(index) ? 'active' : ''}`}>
                    <span className="pinyin">{segment.pinyin || ' '}</span>
                    <span className="hanzi" onClick={(event) => handleSegmentClick(segment, index, event)}>{segment.hanzi}</span>
                  </span>
                ))}
              </article>
            </section>
          )}

          {bubble && (
            <aside className="bubble" style={{ left: bubble.x, top: bubble.y }}>
              <strong>{bubble.text}</strong>
              <small>{bubble.pinyin}</small>
              <p>{bubble.translation}</p>
              <span className="badge">{bubble.granularity}</span>
              <div className="bubble-actions">
                <button onClick={() => speakText(bubble.text)}>Read aloud</button>
                <button onClick={addFlashcard}>Save flashcard</button>
              </div>
            </aside>
          )}

          <section className="flashcards">
            <h3>Saved flashcards</h3>
            <div className="card-grid">
              {flashcards.map((card) => (
                <article key={card.id} className="card">
                  <h4>{card.source_text}</h4>
                  <small>{card.pinyin}</small>
                  <p>{card.translation}</p>
                  <span>{card.granularity}</span>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      {view === 'practice' && (
        <section className="practice-shell">
          <div className="practice-header">
            <h2>Flashcard Practice Mode</h2>
            <label>
              Practice set
              <select value={practiceFilter} onChange={(e) => { setPracticeFilter(e.target.value); setPracticeIndex(0) }}>
                <option value="all">Practice all words</option>
                <option value="unknown">Practice unknown words</option>
              </select>
            </label>
          </div>

          {activePracticeCard ? (
            <article className="practice-card">
              <p className="practice-count">Card {practiceIndex + 1} of {practiceDeck.length}</p>
              <h3>{activePracticeCard.source_text}</h3>
              <small>{activePracticeCard.pinyin || 'No pinyin available'}</small>
              {showAnswer ? <p className="practice-answer">{activePracticeCard.translation}</p> : <p className="practice-answer-hidden">Flip to see translation</p>}

              <div className="practice-actions">
                <button onClick={() => setShowAnswer((v) => !v)}>{showAnswer ? 'Hide Answer' : 'Flip Card'}</button>
                <button onClick={previousPracticeCard}>Previous</button>
                <button onClick={nextPracticeCard}>Next</button>
              </div>

              <div className="practice-actions secondary">
                <button onClick={() => markCardLearned(activePracticeCard.id, false)}>Mark Not Learned</button>
                <button onClick={() => markCardLearned(activePracticeCard.id, true)}>Mark Learned</button>
              </div>
            </article>
          ) : (
            <article className="practice-empty">
              <h3>No cards available for this practice set.</h3>
              <p>Try saving flashcards in the reader, or switch to “Practice all words”.</p>
            </article>
          )}
        </section>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  )
}
