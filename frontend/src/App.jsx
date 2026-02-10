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

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || 'Request failed')
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
  const [flashcards, setFlashcards] = useState([])
  const [error, setError] = useState('')

  const storyPlainText = useMemo(
    () => (story ? story.segments.map((s) => s.hanzi).join('') : ''),
    [story]
  )

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
    const selectedText = window.getSelection().toString().trim()
    if (!selectedText) return

    const granularity = classifySelection(selectedText)
    const selection = window.getSelection()
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    const rect = range?.getBoundingClientRect()

    try {
      const data = await api('/api/lookup', 'POST', token, { text: selectedText, granularity })
      setBubble({
        ...data,
        x: window.scrollX + (rect?.left || 100),
        y: window.scrollY + (rect?.top || 200) - 14
      })
    } catch (err) {
      setError(err.message)
    }
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

  const logout = () => {
    setToken('')
    localStorage.removeItem('token')
    localStorage.removeItem('username')
    setStory(null)
    setSelectedStoryId(null)
    setStories([])
    setLevels([])
    setFlashcards([])
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
              <span key={`${segment.hanzi}-${index}`} className="segment">
                <span className="pinyin">{segment.pinyin || ' '}</span>
                <span className="hanzi" onClick={() => speakText(segment.hanzi)}>{segment.hanzi}</span>
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
      {error && <p className="error">{error}</p>}
    </main>
  )
}
