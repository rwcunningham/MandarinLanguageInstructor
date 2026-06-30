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
    const error = new Error(data.error || `Request failed (${response.status})`)
    error.status = response.status
    throw error
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

const LEITNER_BOXES = [
  { box: 1, label: 'Box 1', interval: 'Daily' },
  { box: 2, label: 'Box 2', interval: 'Every 2 days' },
  { box: 3, label: 'Box 3', interval: 'Every 4 days' },
  { box: 4, label: 'Box 4', interval: 'Weekly' },
  { box: 5, label: 'Box 5', interval: 'Every 2 weeks' }
]

const padDatePart = (value) => String(value).padStart(2, '0')

const toDateKey = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return toDateKey(new Date())
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
}

const dateFromKey = (key) => {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

const addDays = (key, days) => {
  const date = dateFromKey(key)
  date.setDate(date.getDate() + days)
  return toDateKey(date)
}

const shortDateLabel = (key) => (
  dateFromKey(key).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
)

const formatSeconds = (seconds) => {
  const safeSeconds = Math.max(0, Number(seconds) || 0)
  const minutes = Math.floor(safeSeconds / 60)
  const remainder = safeSeconds % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

const questionTypeLabel = (type) => ({
  audio_choice: 'Audio choice',
  gap_fill_choice: 'Gap fill',
  multiple_choice: 'Multiple choice',
  fill_blank: 'Fill in the blank',
  sequence: 'Sequencing',
  speaking_prompt: 'Speaking'
}[type] || 'Question')

const formatQuizAnswer = (value) => (
  String(value || '').includes('||')
    ? String(value).split('||').filter(Boolean).join(' → ')
    : value
)

const storyDifficultyText = (item) => (
  item?.difficulty_label && item.difficulty !== null ? item.difficulty_label : 'Unrated'
)

const getLeitnerBox = (card) => Math.max(1, Math.min(Number(card.leitner_box || 1), 5))

const getLeitnerDueKey = (card) => toDateKey(card.leitner_due_at || card.due_at || card.created_at || new Date())

const directionLabels = {
  'zh-en': 'Mandarin → English',
  'en-zh': 'English → Mandarin'
}

const getMasteryThreshold = (card) => Number(card?.direction_mastery_threshold || 3)

const getDirectionProgress = (card, direction) => {
  if (!card) return 0
  return direction === 'en-zh'
    ? Number(card.en_to_zh_correct_count || 0)
    : Number(card.zh_to_en_correct_count || 0)
}

const getLeitnerPracticeDirection = (card) => card?.leitner_direction || 'zh-en'

const getDirectionalCardContent = (card, direction) => {
  const isEnglishPrompt = direction === 'en-zh'
  return {
    frontMain: isEnglishPrompt ? card.translation : card.source_text,
    frontSub: isEnglishPrompt ? '' : (card.pinyin || 'No pinyin available'),
    frontAudioText: isEnglishPrompt ? card.translation : card.source_text,
    frontAudioLang: isEnglishPrompt ? 'en-US' : 'zh-CN',
    frontAudioLabel: isEnglishPrompt ? 'Play English' : 'Play Chinese',
    frontHint: isEnglishPrompt ? 'Tap to reveal Mandarin' : 'Tap to reveal English',
    backCount: isEnglishPrompt
      ? card.translation
      : `${card.source_text} · ${card.pinyin || 'No pinyin available'}`,
    backMain: isEnglishPrompt ? card.source_text : card.translation,
    backSub: isEnglishPrompt ? (card.pinyin || 'No pinyin available') : '',
    backAudioText: isEnglishPrompt ? card.source_text : card.translation,
    backAudioLang: isEnglishPrompt ? 'zh-CN' : 'en-US',
    backAudioLabel: isEnglishPrompt ? 'Play Mandarin' : 'Play English',
  }
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
  const [profile, setProfile] = useState(null)
  const [summary, setSummary] = useState(null)
  const [view, setView] = useState('reader')
  const [practiceFilter, setPracticeFilter] = useState('due')
  const [practiceDirection, setPracticeDirection] = useState('zh-en')
  const [practiceIndex, setPracticeIndex] = useState(0)
  const [sessionDeck, setSessionDeck] = useState([])
  const [sessionComplete, setSessionComplete] = useState(false)
  const [sessionSaved, setSessionSaved] = useState(false)
  const [reviewedRatings, setReviewedRatings] = useState({})
  const [studyDifficulty, setStudyDifficulty] = useState('again')
  const [leitnerSelectedDate, setLeitnerSelectedDate] = useState(() => toDateKey())
  const [leitnerSessionStarted, setLeitnerSessionStarted] = useState(false)
  const [showAnswer, setShowAnswer] = useState(false)
  const [flyDirection, setFlyDirection] = useState(null)
  const [toastMessage, setToastMessage] = useState('')
  const [correctCards, setCorrectCards] = useState([])
  const [incorrectCards, setIncorrectCards] = useState([])
  const [activeReviewList, setActiveReviewList] = useState(null)
  const [revealedSentences, setRevealedSentences] = useState({})
  const [lookupLoading, setLookupLoading] = useState(false)
  const [savingCard, setSavingCard] = useState(false)
  const [savingWordKey, setSavingWordKey] = useState('')
  const [savingAllWords, setSavingAllWords] = useState(false)
  const [showAllStoryWords, setShowAllStoryWords] = useState(false)
  const [quizDashboard, setQuizDashboard] = useState(null)
  const [activeQuiz, setActiveQuiz] = useState(null)
  const [quizIndex, setQuizIndex] = useState(0)
  const [quizAnswers, setQuizAnswers] = useState({})
  const [quizStartedAt, setQuizStartedAt] = useState(null)
  const [quizElapsed, setQuizElapsed] = useState(0)
  const [quizResult, setQuizResult] = useState(null)
  const [quizLoading, setQuizLoading] = useState(false)
  const [showQuizPinyin, setShowQuizPinyin] = useState(false)
  const [error, setError] = useState('')

  const clearSession = () => {
    setToken('')
    localStorage.removeItem('token')
    localStorage.removeItem('username')
    setStory(null)
    setSelectedStoryId(null)
    setStories([])
    setLevels([])
    setFlashcards([])
    setProfile(null)
    setSummary(null)
    setBubble(null)
    setSelectedRange(null)
    setQuizDashboard(null)
    setActiveQuiz(null)
    setQuizIndex(0)
    setQuizAnswers({})
    setQuizStartedAt(null)
    setQuizElapsed(0)
    setQuizResult(null)
    setQuizLoading(false)
    setShowQuizPinyin(false)
    setError('')
    setView('reader')
  }

  const handleRequestError = (err) => {
    if (err.status === 401) {
      clearSession()
      setError('Your session expired. Please log in again.')
      return
    }
    setError(err.message)
  }

  const storyPlainText = useMemo(
    () => (story ? story.segments.map((s) => s.hanzi).join('') : ''),
    [story]
  )

  const segmentRanges = useMemo(() => {
    if (!story) return []
    let cursor = 0
    return story.segments.map((segment) => {
      const start = cursor
      cursor += segment.hanzi.length
      return { start, end: cursor }
    })
  }, [story])

  const storyVocabulary = useMemo(() => {
    if (!story?.segments) return []
    const seen = new Set()
    return story.segments.reduce((words, segment) => {
      const text = segment.hanzi?.trim()
      if (!text || !segment.pinyin || text.length === 0 || /^[，。！？!?、；;：:]$/.test(text) || seen.has(text)) {
        return words
      }
      seen.add(text)
      words.push({
        text,
        pinyin: segment.pinyin,
        translation: segment.english || 'Translation unavailable',
        granularity: classifySelection(text)
      })
      return words
    }, [])
  }, [story])

  const todayKey = toDateKey()
  const isLeitnerMode = practiceFilter === 'leitner'

  const availablePracticeDeck = useMemo(() => {
    if (practiceFilter === 'leitner') {
      return flashcards.filter((card) => {
        const dueKey = getLeitnerDueKey(card)
        if (leitnerSelectedDate === todayKey) return dueKey <= todayKey
        return dueKey === leitnerSelectedDate
      })
    }
    if (practiceFilter.startsWith('rating:')) {
      const rating = practiceFilter.replace('rating:', '')
      return flashcards.filter((card) => card.last_rating === rating)
    }
    if (practiceFilter === 'unknown') {
      return flashcards.filter((card) => card.status !== 'known')
    }
    if (practiceFilter === 'due') {
      const now = Date.now()
      return flashcards.filter((card) => !card.due_at || Date.parse(card.due_at) <= now)
    }
    if (practiceFilter === 'known') {
      return flashcards.filter((card) => card.status === 'known')
    }
    return flashcards
  }, [flashcards, practiceFilter, leitnerSelectedDate, todayKey])

  const practiceDeck = sessionDeck
  const activePracticeCard = !sessionComplete && (!isLeitnerMode || leitnerSessionStarted) ? practiceDeck[practiceIndex] || null : null
  const activePracticeDirection = activePracticeCard && isLeitnerMode ? getLeitnerPracticeDirection(activePracticeCard) : practiceDirection
  const activePracticeContent = activePracticeCard ? getDirectionalCardContent(activePracticeCard, activePracticeDirection) : null
  const activeDirectionProgress = activePracticeCard ? getDirectionProgress(activePracticeCard, activePracticeDirection) : 0
  const activeMasteryThreshold = activePracticeCard ? getMasteryThreshold(activePracticeCard) : 3
  const answeredCount = correctCards.length + incorrectCards.length
  const scorePercent = practiceDeck.length ? Math.round((correctCards.length / practiceDeck.length) * 100) : 0
  const ratingBreakdown = useMemo(() => (
    Object.values(reviewedRatings).reduce((totals, rating) => ({
      ...totals,
      [rating]: (totals[rating] || 0) + 1
    }), { again: 0, hard: 0, good: 0, easy: 0 })
  ), [reviewedRatings])
  const leitnerCalendarDays = useMemo(() => (
    Array.from({ length: 14 }, (_, offset) => {
      const key = addDays(todayKey, offset)
      const dayCards = flashcards.filter((card) => {
        const dueKey = getLeitnerDueKey(card)
        if (key === todayKey) return dueKey <= todayKey
        return dueKey === key
      })
      const boxes = LEITNER_BOXES.map(({ box }) => ({
        box,
        count: dayCards.filter((card) => getLeitnerBox(card) === box).length
      }))
      return {
        key,
        label: key === todayKey ? 'Today' : shortDateLabel(key),
        total: dayCards.length,
        boxes,
        cards: dayCards
      }
    })
  ), [flashcards, todayKey])
  const leitnerSelectedDay = leitnerCalendarDays.find((day) => day.key === leitnerSelectedDate) || leitnerCalendarDays[0]
  const leitnerTodayCards = leitnerCalendarDays[0]?.cards || []
  const leitnerMasteredCards = flashcards.filter((card) => card.leitner_mastered).length
  const leitnerBoxSummaries = LEITNER_BOXES.map((boxConfig) => {
    const boxCards = flashcards.filter((card) => getLeitnerBox(card) === boxConfig.box)
    const dueCards = boxCards.filter((card) => getLeitnerDueKey(card) <= todayKey)
    return { ...boxConfig, total: boxCards.length, dueCards }
  })
  const activeQuestion = activeQuiz?.questions?.[quizIndex] || null
  const quizQuestionCount = activeQuiz?.questions?.length || 0
  const quizAnsweredCount = activeQuiz?.questions?.filter((question) => (
    String(quizAnswers[question.id] || '').trim().length > 0
  )).length || 0
  const quizCompletionPercent = quizQuestionCount ? Math.round((quizAnsweredCount / quizQuestionCount) * 100) : 0
  const quizStoriesByLevel = useMemo(() => (
    (quizDashboard?.stories || []).reduce((groups, item) => ({
      ...groups,
      [item.level]: [...(groups[item.level] || []), item]
    }), {})
  ), [quizDashboard])
  const quizStoryById = useMemo(() => (
    (quizDashboard?.stories || []).reduce((lookup, item) => ({ ...lookup, [item.id]: item }), {})
  ), [quizDashboard])
  const quizLevelOrder = useMemo(() => {
    const dashboardLevels = Object.keys(quizStoriesByLevel)
    const ordered = levels.filter((level) => dashboardLevels.includes(level))
    return ordered.length ? ordered : dashboardLevels
  }, [levels, quizStoriesByLevel])
  const quizPassPercent = quizDashboard?.metrics?.available_quizzes
    ? Math.round((quizDashboard.metrics.quizzes_passed / quizDashboard.metrics.available_quizzes) * 100)
    : 0
  const quizResultByQuestionId = useMemo(() => (
    (quizResult?.results || []).reduce((lookup, item) => ({ ...lookup, [item.question_id]: item }), {})
  ), [quizResult])

  const resetPracticeSession = (deck = availablePracticeDeck) => {
    setSessionDeck(deck)
    setPracticeIndex(0)
    setCorrectCards([])
    setIncorrectCards([])
    setReviewedRatings({})
    setActiveReviewList(null)
    setToastMessage('')
    setFlyDirection(null)
    setShowAnswer(false)
    setSessionComplete(false)
    setSessionSaved(false)
  }

  useEffect(() => {
    if (practiceIndex > 0 && practiceIndex >= sessionDeck.length) {
      setPracticeIndex(Math.max(sessionDeck.length - 1, 0))
    }
    setShowAnswer(false)
    setFlyDirection(null)
  }, [sessionDeck.length, practiceIndex])

  useEffect(() => {
    if (practiceFilter === 'leitner') {
      setLeitnerSessionStarted(false)
      resetPracticeSession([])
      return
    }
    resetPracticeSession(availablePracticeDeck)
  }, [practiceFilter])

  useEffect(() => {
    if (!isLeitnerMode && sessionDeck.length === 0 && answeredCount === 0 && !sessionComplete && availablePracticeDeck.length > 0) {
      setSessionDeck(availablePracticeDeck)
    }
  }, [availablePracticeDeck.length, answeredCount, isLeitnerMode, sessionComplete, sessionDeck.length])

  useEffect(() => {
    if (isLeitnerMode && !leitnerSessionStarted) {
      resetPracticeSession([])
    }
  }, [leitnerSelectedDate])

  const isSegmentHighlighted = (index) => {
    if (!selectedRange) return false
    const range = segmentRanges[index]
    if (!range) return false
    return range.start < selectedRange.end && range.end > selectedRange.start
  }

  const refreshLearningData = async () => {
    const [cardData, summaryData] = await Promise.all([
      api('/api/flashcards', 'GET', token),
      api('/api/progress/summary', 'GET', token)
    ])
    setFlashcards(cardData.flashcards)
    setSummary(summaryData.summary)
  }

  const refreshQuizDashboard = async () => {
    const data = await api('/api/quizzes', 'GET', token)
    setQuizDashboard(data)
    return data
  }

  const findSentenceForSegment = (segmentIndex) => {
    if (!story?.sentences || segmentIndex == null) return null
    return story.sentences.find((sentence) => (
      segmentIndex >= sentence.start_segment && segmentIndex <= sentence.end_segment
    )) || null
  }

  const selectText = async (selectedText, rect, range, options = {}) => {
    if (!selectedText) return
    const granularity = classifySelection(selectedText)
    const activeSentence = options.sentence || findSentenceForSegment(options.segmentIndex)

    try {
      setLookupLoading(true)
      const data = await api('/api/lookup', 'POST', token, {
        text: selectedText,
        granularity: options.granularity || granularity,
        story_id: story?.id,
        segment_index: options.segmentIndex,
        sentence_text: activeSentence?.hanzi || ''
      })
      const anchorX = window.scrollX + ((rect?.left || 100) + ((rect?.width || 0) / 2))
      const minX = window.scrollX + 40
      const maxX = window.scrollX + window.innerWidth - 40
      const clampedX = Math.min(maxX, Math.max(minX, anchorX))

      setBubble({
        ...data,
        context_sentence: activeSentence?.hanzi || '',
        context_sentence_pinyin: activeSentence?.pinyin || '',
        context_sentence_literal_english: activeSentence?.literal_english || '',
        context_sentence_english: activeSentence?.natural_english || activeSentence?.english || '',
        x: clampedX,
        y: window.scrollY + (rect?.bottom || 220) + 14
      })
      setSelectedRange(range)
      const summaryData = await api('/api/progress/summary', 'GET', token)
      setSummary(summaryData.summary)
    } catch (err) {
      setError(err.message)
    } finally {
      setLookupLoading(false)
    }
  }

  useEffect(() => {
    if (!token) return
    ;(async () => {
      try {
        const [levelData, profileData, cardData, summaryData] = await Promise.all([
          api('/api/levels', 'GET', token),
          api('/api/profile', 'GET', token),
          api('/api/flashcards', 'GET', token),
          api('/api/progress/summary', 'GET', token)
        ])
        setLevels(levelData.levels)
        setProfile(profileData.profile)
        setFlashcards(cardData.flashcards)
        setSummary(summaryData.summary)
        if (profileData.profile?.current_level) {
          setSelectedLevel(profileData.profile.current_level)
        }
      } catch (err) {
        handleRequestError(err)
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

  useEffect(() => {
    if (!token || view !== 'quizzes') return
    ;(async () => {
      try {
        await refreshQuizDashboard()
      } catch (err) {
        handleRequestError(err)
      }
    })()
  }, [token, view])

  useEffect(() => {
    if (view !== 'quizzes' || !activeQuiz || quizResult || !quizStartedAt) return undefined
    const updateElapsed = () => setQuizElapsed(Math.floor((Date.now() - quizStartedAt) / 1000))
    updateElapsed()
    const timerId = window.setInterval(updateElapsed, 1000)
    return () => window.clearInterval(timerId)
  }, [activeQuiz, quizResult, quizStartedAt, view])

  const changeLevel = async (level) => {
    setSelectedLevel(level)
    setSelectedStoryId(null)
    setStory(null)
    setStories([])
    setBubble(null)
    setSelectedRange(null)
    setRevealedSentences({})
    if (profile) {
      try {
        const data = await api('/api/profile', 'PATCH', token, { current_level: level })
        setProfile(data.profile)
      } catch (err) {
        setError(err.message)
      }
    }
  }

  const updatePinyinMode = async (pinyinMode) => {
    try {
      const data = await api('/api/profile', 'PATCH', token, { pinyin_mode: pinyinMode })
      setProfile(data.profile)
    } catch (err) {
      setError(err.message)
    }
  }

  const updateEnglishMode = async (englishMode) => {
    try {
      const data = await api('/api/profile', 'PATCH', token, { english_mode: englishMode })
      setProfile(data.profile)
    } catch (err) {
      setError(err.message)
    }
  }

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

  const getSegmentIndexFromNode = (node) => {
    const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node
    const segment = element?.closest?.('[data-segment-index]')
    return segment ? Number(segment.dataset.segmentIndex) : null
  }

  const handleMouseUp = async () => {
    if (!story) return
    const selection = window.getSelection()
    const selectedText = selection.toString().trim()
    if (!selectedText) return

    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    const rect = range?.getBoundingClientRect()
    const anchorIndex = getSegmentIndexFromNode(selection.anchorNode)
    const focusIndex = getSegmentIndexFromNode(selection.focusNode)
    const firstIndex = anchorIndex == null || focusIndex == null ? null : Math.min(anchorIndex, focusIndex)
    const lastIndex = anchorIndex == null || focusIndex == null ? null : Math.max(anchorIndex, focusIndex)
    const resolvedRange = firstIndex == null
      ? null
      : { start: segmentRanges[firstIndex].start, end: segmentRanges[lastIndex].end }

    await selectText(selectedText, rect, resolvedRange, { segmentIndex: firstIndex })
  }

  const handleSegmentClick = async (segment, index, event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const range = segmentRanges[index]
    await selectText(segment.hanzi, rect, range, { segmentIndex: index })
  }

  const addFlashcard = async () => {
    if (!bubble) return
    try {
      setSavingCard(true)
      await api('/api/flashcards', 'POST', token, {
        source_text: bubble.text,
        pinyin: bubble.pinyin,
        translation: bubble.translation,
        granularity: bubble.granularity,
        story_id: story?.id,
        context_sentence: bubble.context_sentence || ''
      })
      await refreshLearningData()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingCard(false)
    }
  }

  const saveSentenceFlashcard = async (sentence) => {
    try {
      await api('/api/flashcards', 'POST', token, {
        source_text: sentence.hanzi,
        pinyin: sentence.pinyin,
        translation: sentence.english,
        granularity: 'sentence',
        story_id: story?.id,
        context_sentence: sentence.hanzi
      })
      await refreshLearningData()
    } catch (err) {
      setError(err.message)
    }
  }

  const saveVocabularyFlashcard = async (word) => {
    try {
      setSavingWordKey(word.text)
      await api('/api/flashcards', 'POST', token, {
        source_text: word.text,
        pinyin: word.pinyin,
        translation: word.translation,
        granularity: word.granularity,
        story_id: story?.id,
        context_sentence: story?.title || ''
      })
      await refreshLearningData()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingWordKey('')
    }
  }

  const saveAllVocabularyFlashcards = async () => {
    if (storyVocabulary.length === 0) return
    try {
      setSavingAllWords(true)
      await Promise.all(storyVocabulary.map((word) => api('/api/flashcards', 'POST', token, {
        source_text: word.text,
        pinyin: word.pinyin,
        translation: word.translation,
        granularity: word.granularity,
        story_id: story?.id,
        context_sentence: story?.title || ''
      })))
      await refreshLearningData()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingAllWords(false)
    }
  }

  const speakText = (text, lang = 'zh-CN') => {
    if (!window.speechSynthesis) return
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang
    window.speechSynthesis.speak(utterance)
  }

  const reviewCard = async (cardId, rating, shouldAdvance = true, direction = practiceDirection) => {
    try {
      await api(`/api/flashcards/${cardId}/review`, 'POST', token, {
        rating,
        mode: isLeitnerMode ? 'leitner' : 'standard',
        direction
      })
      await refreshLearningData()
      if (shouldAdvance) nextPracticeCard()
    } catch (err) {
      setError(err.message)
    }
  }

  const recordPracticeSession = async (nextCorrectCards, nextIncorrectCards, nextReviewedRatings) => {
    if (sessionSaved || practiceDeck.length === 0) return
    const breakdown = Object.values(nextReviewedRatings).reduce((totals, rating) => ({
      ...totals,
      [rating]: (totals[rating] || 0) + 1
    }), { again: 0, hard: 0, good: 0, easy: 0 })
    try {
      setSessionSaved(true)
      await api('/api/flashcard-sessions', 'POST', token, {
        practice_filter: practiceFilter,
        total_cards: practiceDeck.length,
        correct_count: nextCorrectCards.length,
        incorrect_count: nextIncorrectCards.length,
        rating_breakdown: breakdown
      })
      const profileData = await api('/api/profile', 'GET', token)
      setProfile(profileData.profile)
    } catch (err) {
      setSessionSaved(false)
      setError(err.message)
    }
  }

  const findNextUnreviewedIndex = (ratings, startIndex = practiceIndex) => {
    if (practiceDeck.length === 0) return -1
    for (let offset = 1; offset <= practiceDeck.length; offset += 1) {
      const index = (startIndex + offset) % practiceDeck.length
      const card = practiceDeck[index]
      if (card && !ratings[card.id]) return index
    }
    return -1
  }

  const markPracticeCard = (card, rating, direction, message) => {
    if (!card || flyDirection || reviewedRatings[card.id] || sessionComplete) return
    const reviewDirection = isLeitnerMode ? getLeitnerPracticeDirection(card) : practiceDirection
    const nextCorrectCards = direction === 'right' ? [...correctCards, card] : correctCards
    const nextIncorrectCards = direction === 'right' ? incorrectCards : [...incorrectCards, card]
    const nextReviewedRatings = { ...reviewedRatings, [card.id]: rating }
    const nextIndex = findNextUnreviewedIndex(nextReviewedRatings)

    setCorrectCards(nextCorrectCards)
    setIncorrectCards(nextIncorrectCards)
    setReviewedRatings(nextReviewedRatings)
    setToastMessage(message)
    setFlyDirection(direction)

    window.setTimeout(async () => {
      await reviewCard(card.id, rating, false, reviewDirection)
      setFlyDirection(null)
      setShowAnswer(false)
      if (nextIndex === -1) {
        setSessionComplete(true)
        await recordPracticeSession(nextCorrectCards, nextIncorrectCards, nextReviewedRatings)
      } else {
        setPracticeIndex(nextIndex)
      }
      window.setTimeout(() => setToastMessage(''), 900)
    }, 260)
  }

  const deleteCard = async (cardId) => {
    try {
      await api(`/api/flashcards/${cardId}`, 'DELETE', token)
      await refreshLearningData()
    } catch (err) {
      setError(err.message)
    }
  }

  const completeStory = async (comprehension) => {
    if (!story) return
    try {
      const data = await api(`/api/stories/${story.id}/progress`, 'POST', token, {
        status: 'completed',
        last_segment_index: story.segments.length - 1,
        comprehension
      })
      setStory((current) => ({
        ...current,
        progress: data.progress,
        difficulty: data.difficulty_stats?.difficulty ?? current.difficulty,
        difficulty_label: data.difficulty_stats?.difficulty_label ?? current.difficulty_label,
        difficulty_stats: data.difficulty_stats || current.difficulty_stats
      }))
      await refreshLearningData()
      if (selectedLevel) {
        const levelData = await api(`/api/stories?level=${selectedLevel}`, 'GET', token)
        setStories(levelData.stories)
      }
    } catch (err) {
      setError(err.message)
    }
  }

  const startQuiz = async (storyId) => {
    try {
      setQuizLoading(true)
      setError('')
      const data = await api(`/api/quizzes/${storyId}`, 'GET', token)
      setActiveQuiz(data.quiz)
      setQuizIndex(0)
      setQuizAnswers({})
      setQuizResult(null)
      setQuizElapsed(0)
      setQuizStartedAt(Date.now())
      setShowQuizPinyin(false)
    } catch (err) {
      handleRequestError(err)
    } finally {
      setQuizLoading(false)
    }
  }

  const returnToQuizDashboard = async () => {
    setActiveQuiz(null)
    setQuizIndex(0)
    setQuizAnswers({})
    setQuizStartedAt(null)
    setQuizElapsed(0)
    setQuizResult(null)
    setShowQuizPinyin(false)
    try {
      await refreshQuizDashboard()
    } catch (err) {
      handleRequestError(err)
    }
  }

  const answerQuizQuestion = (questionId, value) => {
    setQuizAnswers((answers) => ({ ...answers, [questionId]: value }))
  }

  const getSequenceAnswer = (questionId) => (
    String(quizAnswers[questionId] || '').split('||').filter(Boolean)
  )

  const addSequenceChoice = (questionId, choice) => {
    const current = getSequenceAnswer(questionId)
    if (current.includes(choice)) return
    answerQuizQuestion(questionId, [...current, choice].join('||'))
  }

  const moveSequenceChoice = (questionId, choice, targetIndex) => {
    const current = getSequenceAnswer(questionId)
    const remaining = current.filter((item) => item !== choice)
    const next = [...remaining]
    next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, choice)
    answerQuizQuestion(questionId, next.join('||'))
  }

  const handleSequenceDrop = (event, questionId, targetIndex) => {
    event.preventDefault()
    const choice = event.dataTransfer.getData('text/plain')
    if (!choice) return
    moveSequenceChoice(questionId, choice, targetIndex)
  }

  const clearSequenceAnswer = (questionId) => {
    answerQuizQuestion(questionId, '')
  }

  const previousQuizQuestion = () => {
    setShowQuizPinyin(false)
    setQuizIndex((index) => Math.max(index - 1, 0))
  }

  const nextQuizQuestion = () => {
    setShowQuizPinyin(false)
    setQuizIndex((index) => Math.min(index + 1, Math.max(quizQuestionCount - 1, 0)))
  }

  const submitQuiz = async () => {
    if (!activeQuiz || quizQuestionCount === 0 || quizAnsweredCount < quizQuestionCount) return
    try {
      setQuizLoading(true)
      const data = await api(`/api/quizzes/${activeQuiz.story.id}/attempts`, 'POST', token, {
        answers: quizAnswers,
        elapsed_seconds: quizElapsed
      })
      setQuizResult(data)
      setQuizStartedAt(null)
      await Promise.all([
        refreshQuizDashboard(),
        refreshLearningData()
      ])
    } catch (err) {
      handleRequestError(err)
    } finally {
      setQuizLoading(false)
    }
  }

  const retakeQuiz = () => {
    if (!activeQuiz) return
    startQuiz(activeQuiz.story.id)
  }

  const nextPracticeCard = () => {
    if (practiceDeck.length <= 1) return
    setPracticeIndex((i) => {
      for (let index = i + 1; index < practiceDeck.length; index += 1) {
        if (!reviewedRatings[practiceDeck[index]?.id]) return index
      }
      return i
    })
    setShowAnswer(false)
  }

  const previousPracticeCard = () => {
    if (practiceDeck.length <= 1) return
    setPracticeIndex((i) => {
      for (let index = i - 1; index >= 0; index -= 1) {
        if (!reviewedRatings[practiceDeck[index]?.id]) return index
      }
      return i
    })
    setShowAnswer(false)
  }

  const handleFlipPracticeCard = () => {
    if (flyDirection) return
    setShowAnswer((value) => !value)
  }

  const handleAudioClick = (event, text, lang = 'zh-CN') => {
    event.stopPropagation()
    speakText(text, lang)
  }

  const handleMarkIncorrect = () => {
    markPracticeCard(activePracticeCard, 'again', 'left', 'Incorrect')
  }

  const handleMarkCorrect = () => {
    markPracticeCard(activePracticeCard, 'good', 'right', 'Correct')
  }

  const reviewListCards = activeReviewList === 'correct' ? correctCards : incorrectCards
  const reviewListTitle = activeReviewList === 'correct' ? 'Correct cards' : 'Incorrect cards'
  const reviewListEmpty = activeReviewList === 'correct' ? 'No correct cards yet.' : 'No incorrect cards yet.'
  const ratingLabels = {
    again: 'Again',
    hard: 'Hard',
    good: 'Good',
    easy: 'Easy'
  }
  const practiceFilterLabel = practiceFilter.startsWith('rating:')
    ? `${ratingLabels[practiceFilter.replace('rating:', '')]} difficulty`
    : {
        due: 'Due now',
        all: 'All words',
        unknown: 'Unknown words',
        known: 'Known words',
        leitner: 'Leitner Mode'
      }[practiceFilter] || practiceFilter
  const formatPracticeFilter = (filter) => (
    filter?.startsWith?.('rating:')
      ? `${ratingLabels[filter.replace('rating:', '')]} difficulty`
      : {
          due: 'Due now',
          all: 'All words',
          unknown: 'Unknown words',
          known: 'Known words',
          leitner: 'Leitner Mode'
        }[filter] || filter || 'Practice set'
  )
  const startLeitnerSession = (deck) => {
    setLeitnerSessionStarted(true)
    resetPracticeSession(deck)
  }
  const startIncorrectReview = () => {
    resetPracticeSession(incorrectCards)
  }
  const startDifficultyReview = () => {
    const difficultyDeck = practiceDeck.filter((card) => reviewedRatings[card.id] === studyDifficulty)
    resetPracticeSession(difficultyDeck)
  }

  useEffect(() => {
    if (view !== 'practice') return undefined

    const handlePracticeKeys = (event) => {
      const target = event.target
      const tagName = target?.tagName?.toLowerCase()
      if (tagName === 'input' || tagName === 'select' || tagName === 'textarea' || target?.isContentEditable) return
      if (!activePracticeCard || flyDirection) return

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        previousPracticeCard()
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        nextPracticeCard()
      }
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        handleFlipPracticeCard()
      }
    }

    window.addEventListener('keydown', handlePracticeKeys)
    return () => window.removeEventListener('keydown', handlePracticeKeys)
  }, [activePracticeCard, flyDirection, view, practiceDeck.length])

  const logout = () => {
    clearSession()
  }

  if (!token) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>Mandarin Story Coach</h1>
          <p>Read Chinese stories with pinyin, smart lookups, and speech support.</p>
          <div className="auth-toggle">
            {mode === 'login' ? (
              <button className="btn-quiet" onClick={() => setMode('signup')}>Create User</button>
            ) : (
              <button className="btn-quiet" onClick={() => setMode('login')}>Log In</button>
            )}
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
          <button className="btn-primary" onClick={authenticate}>{mode === 'login' ? 'Log In' : 'Sign Up'}</button>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header>
        <h1>Welcome, {username}</h1>
        <button className="btn-danger" onClick={logout}>Logout</button>
      </header>

      <nav className="top-nav">
        <button className={view === 'reader' ? 'active' : ''} onClick={() => setView('reader')}>Story Reader</button>
        <button className={view === 'practice' ? 'active' : ''} onClick={() => setView('practice')}>Flashcard Practice Mode</button>
        <button className={view === 'quizzes' ? 'active' : ''} onClick={() => setView('quizzes')}>Quizzes</button>
        <button className={view === 'profile' ? 'active' : ''} onClick={() => setView('profile')}>Profile</button>
      </nav>

      {summary && (
        <section className="dashboard-strip">
          <article><strong>{summary.completed_stories}</strong><span>Stories completed</span></article>
          <article><strong>{summary.total_cards}</strong><span>Flashcards in your deck</span></article>
          <article><strong>{summary.known_cards}</strong><span>Words learned</span></article>
          <article><strong>{summary.quiz_level_complete || 0}</strong><span>Quizzes passed</span></article>
        </section>
      )}

      {view === 'reader' && (
        <>
          <section className="control-row">
            <label>
              Reading level
              <select value={selectedLevel} onChange={(e) => changeLevel(e.target.value)}>
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
                  <option key={s.id} value={s.id}>
                    {s.display_title || `${s.story_number}. ${s.title}`} · {s.title_pinyin} · Difficulty: {storyDifficultyText(s)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Pinyin
              <select value={profile?.pinyin_mode || 'always'} onChange={(e) => updatePinyinMode(e.target.value)}>
                <option value="always">Always show</option>
                <option value="hover">Show on hover</option>
                <option value="hidden">Hide</option>
              </select>
            </label>

            <label>
              English translation
              <select value={profile?.english_mode || 'hidden'} onChange={(e) => updateEnglishMode(e.target.value)}>
                <option value="always">Always show</option>
                <option value="hover">Show on hover</option>
                <option value="hidden">Hide</option>
              </select>
            </label>
          </section>

          {story && (
            <section className={`reader pinyin-${profile?.pinyin_mode || 'always'} english-${profile?.english_mode || 'hidden'}`} onMouseUp={handleMouseUp}>
              <div className="reader-header">
                <div>
                  <h2 title={story.title_english || ''}>
                    {story.display_title || `${story.story_number}. ${story.title}`}
                    <span className="story-difficulty-badge">{storyDifficultyText(story)}</span>
                  </h2>
                  {story.title_pinyin && <p className="story-title-pinyin">{story.title_pinyin}</p>}
                  <p>{story.progress?.status === 'completed' ? 'Completed' : 'In progress'} · {story.progress?.lookup_count || 0} lookups · {story.progress?.saved_count || 0} saved</p>
                </div>
                <button className="btn-primary" onClick={() => speakText(storyPlainText)}>Listen to full story</button>
              </div>
              <article className="story-grid">
                {story.segments.map((segment, index) => (
                  <span
                    key={`${segment.hanzi}-${index}`}
                    className={`segment ${isSegmentHighlighted(index) ? 'active' : ''}`}
                    data-segment-index={index}
                  >
                    <span className="pinyin">{segment.pinyin || ' '}</span>
                    <span
                      className="hanzi"
                      role="button"
                      tabIndex={0}
                      onClick={(event) => handleSegmentClick(segment, index, event)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          handleSegmentClick(segment, index, event)
                        }
                      }}
                    >
                      {segment.hanzi}
                    </span>
                    <span className="segment-english">{segment.english && !/^[,.]$/.test(segment.english) ? segment.english : ' '}</span>
                  </span>
                ))}
              </article>

              <section className="sentence-panel">
                <h3>Sentence coach</h3>
                {story.sentences?.map((sentence) => (
                  <article key={sentence.id} className="sentence-card">
                    <div>
                      <h4>{sentence.hanzi}</h4>
                      <p className="sentence-pinyin">{sentence.pinyin}</p>
                      {revealedSentences[sentence.id] && (
                        <>
                          <div className="translation-pair sentence-translation manual-reveal">
                            <p><span>Word for word</span>{sentence.literal_english || sentence.english}</p>
                            <p><span>Natural English</span>{sentence.natural_english || sentence.english}</p>
                          </div>
                          {sentence.grammar_note && <p className="grammar-note">{sentence.grammar_note}</p>}
                        </>
                      )}
                    </div>
                    <div className="sentence-actions">
                      <button className="btn-quiet" onClick={() => setRevealedSentences((prev) => ({ ...prev, [sentence.id]: !prev[sentence.id] }))}>
                        {revealedSentences[sentence.id] ? 'Hide' : 'Reveal'}
                      </button>
                      <button className="btn-quiet" onClick={() => speakText(sentence.hanzi)}>Listen</button>
                      <button className="btn-quiet" onClick={(event) => selectText(sentence.hanzi, event.currentTarget.getBoundingClientRect(), {
                        start: segmentRanges[sentence.start_segment].start,
                        end: segmentRanges[sentence.end_segment].end
                      }, { granularity: 'sentence', segmentIndex: sentence.start_segment, sentence })}>Inspect</button>
                      <button className="btn-primary" onClick={() => saveSentenceFlashcard(sentence)}>Save</button>
                    </div>
                  </article>
                ))}
              </section>

              {storyVocabulary.length > 0 && (
                <section className="story-vocab-card">
                  <div className="story-vocab-header">
                    <div>
                      <h3>Story words</h3>
                      <p>{storyVocabulary.length} unique words in this story</p>
                    </div>
                    <div className="story-vocab-actions">
                      <button className="btn-primary" onClick={saveAllVocabularyFlashcards} disabled={savingAllWords}>
                        {savingAllWords ? 'Adding...' : 'Add all flashcards'}
                      </button>
                      <button className="btn-quiet" onClick={() => setShowAllStoryWords((value) => !value)}>
                        {showAllStoryWords ? 'Show less' : 'See all'}
                      </button>
                    </div>
                  </div>
                  <div className="story-vocab-list">
                    {(showAllStoryWords ? storyVocabulary : storyVocabulary.slice(0, 1)).map((word) => (
                      <article key={word.text} className="story-vocab-item">
                        <div>
                          <h4>{word.text}</h4>
                          <small>{word.pinyin}</small>
                          <p>{word.translation}</p>
                        </div>
                        <button className="btn-quiet" onClick={() => saveVocabularyFlashcard(word)} disabled={savingWordKey === word.text || savingAllWords}>
                          {savingWordKey === word.text ? 'Saving...' : 'Save flashcard'}
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              <section className="completion-row">
                <span>When you finish, mark how the story felt.</span>
                <button className="btn-danger" onClick={() => completeStory('hard')}>Hard</button>
                <button className="btn-quiet" onClick={() => completeStory('medium')}>Medium</button>
                <button className="btn-primary" onClick={() => completeStory('easy')}>Easy</button>
              </section>
              {story.difficulty_stats?.total_ratings > 0 && (
                <section className="story-difficulty-panel">
                  <div>
                    <h3>User difficulty ratings</h3>
                    <p>Assigned difficulty: <strong>{storyDifficultyText(story)}</strong> from {story.difficulty_stats.total_ratings} rating{story.difficulty_stats.total_ratings === 1 ? '' : 's'}.</p>
                  </div>
                  <div className="difficulty-bars">
                    {[
                      ['hard', 'Said hard'],
                      ['medium', 'Said medium'],
                      ['easy', 'Said easy']
                    ].map(([key, label]) => (
                      <div key={key} className="difficulty-bar-row">
                        <span>{label}</span>
                        <div><b style={{ width: `${story.difficulty_stats.percentages?.[key] || 0}%` }} /></div>
                        <strong>{story.difficulty_stats.percentages?.[key] || 0}%</strong>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </section>
          )}

          {bubble && (
            <aside className="bubble" style={{ left: bubble.x, top: bubble.y }}>
              <button className="bubble-close btn-quiet" type="button" aria-label="Close definition" onClick={() => { setBubble(null); setSelectedRange(null) }}>
                ×
              </button>
              <strong>{bubble.text}</strong>
              <small>{bubble.pinyin}</small>
              <div className="translation-pair compact">
                <p><span>Word for word</span>{bubble.literal_translation || bubble.translation}</p>
                <p><span>Natural English</span>{bubble.natural_translation || bubble.translation}</p>
              </div>
              {bubble.grammar_note && <p className="grammar-note">{bubble.grammar_note}</p>}
              {bubble.context_sentence && (
                <div className="example-sentence">
                  <span>Example sentence</span>
                  <strong>{bubble.context_sentence}</strong>
                  {bubble.context_sentence_pinyin && <small>{bubble.context_sentence_pinyin}</small>}
                  {bubble.context_sentence_english && <p>{bubble.context_sentence_english}</p>}
                </div>
              )}
              {bubble.alternatives?.filter((item) => item.label !== 'Sentence context').length > 0 && (
                <div className="lookup-alternatives">
                  {bubble.alternatives.filter((item) => item.label !== 'Sentence context').slice(0, 3).map((item) => (
                    <span key={`${item.label}-${item.text}`}>{item.label}: {item.text}</span>
                  ))}
                </div>
              )}
              <span className="badge">{bubble.granularity}</span>
              <span className="badge muted">{bubble.source}</span>
              <div className="bubble-actions">
                <button className="btn-quiet" onClick={() => speakText(bubble.text)}>Read aloud</button>
                <button className="btn-primary" onClick={addFlashcard} disabled={savingCard}>{savingCard ? 'Saving...' : 'Save flashcard'}</button>
              </div>
            </aside>
          )}

          {lookupLoading && <p className="status-line">Looking that up...</p>}

          <section className="flashcards">
            <h3>Saved flashcards</h3>
            <div className="card-grid">
              {flashcards.map((card) => (
                <article key={card.id} className="card">
                  <h4>{card.source_text}</h4>
                  <small>{card.pinyin}</small>
                  <p>{card.translation}</p>
                  {card.context_sentence && <p className="card-context">{card.context_sentence}</p>}
                  <span>{card.granularity} · {card.status}</span>
                  <button className="btn-danger" onClick={() => deleteCard(card.id)}>Delete</button>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      {view === 'quizzes' && (
        <section className="quiz-shell">
          {activeQuiz ? (
            <>
              <div className="quiz-header">
                <div>
                  <h2>{activeQuiz.story.display_title || activeQuiz.story.title}</h2>
                  <p>{activeQuiz.story.title_pinyin} · {activeQuiz.story.level}</p>
                </div>
                <div className="quiz-header-actions">
                  <span className="quiz-clock">{formatSeconds(quizElapsed)}</span>
                  <button className="btn-quiet" type="button" onClick={returnToQuizDashboard}>Back to quizzes</button>
                </div>
              </div>

              <div className="quiz-progress-panel">
                <div className="quiz-progress-text">
                  <strong>{quizCompletionPercent}% complete</strong>
                  <span>{quizAnsweredCount}/{quizQuestionCount} answered · Question {Math.min(quizIndex + 1, quizQuestionCount)} of {quizQuestionCount}</span>
                </div>
                <div className="quiz-progress-track" aria-label="Quiz progress">
                  <span style={{ width: `${quizCompletionPercent}%` }} />
                </div>
                <div className="quiz-dots" aria-label="Question status">
                  {activeQuiz.questions.map((question, index) => (
                    <button
                      key={question.id}
                      type="button"
                      className={`${index === quizIndex ? 'current' : ''} ${String(quizAnswers[question.id] || '').trim() ? 'answered' : ''}`}
                      aria-label={`Go to question ${index + 1}`}
                      onClick={() => setQuizIndex(index)}
                    />
                  ))}
                </div>
              </div>

              {quizResult ? (
                <article className={`quiz-result-card ${quizResult.attempt.passed ? 'passed' : ''}`}>
                  <div>
                    <span className="badge">{quizResult.attempt.passed ? 'Passed' : 'Keep practicing'}</span>
                    <h3>{quizResult.attempt.score_percent}%</h3>
                    <p>{quizResult.attempt.correct_count}/{quizResult.attempt.total_questions} correct · {formatSeconds(quizResult.attempt.elapsed_seconds)}</p>
                  </div>
                  <div className="quiz-review-list">
                    {activeQuiz.questions.map((question) => {
                      const result = quizResultByQuestionId[question.id]
                      return (
                        <article key={question.id} className={`quiz-review-item ${result?.correct ? 'correct' : 'missed'}`}>
                          <strong>{question.prompt}</strong>
                          <span>Your answer: {result?.submitted ? formatQuizAnswer(result.submitted) : 'No answer'}</span>
                          {!result?.correct && <span>Correct answer: {formatQuizAnswer(result?.answer)}</span>}
                          {result?.explanation && <small>{result.explanation}</small>}
                        </article>
                      )
                    })}
                  </div>
                  <div className="quiz-result-actions">
                    <button className="btn-primary" type="button" onClick={retakeQuiz}>Retake quiz</button>
                    <button className="btn-quiet" type="button" onClick={returnToQuizDashboard}>Choose another quiz</button>
                  </div>
                </article>
              ) : activeQuestion ? (
                <article className="quiz-player-card">
                  <div className="quiz-question-meta">
                    <span className="badge">{questionTypeLabel(activeQuestion.type)}</span>
                    {activeQuestion.skill && <span className="badge muted">{activeQuestion.skill}</span>}
                  </div>
                  {activeQuestion.audio_text && (
                    <button className="quiz-audio-button btn-primary" type="button" onClick={() => speakText(activeQuestion.audio_text)}>
                      Play Mandarin audio
                    </button>
                  )}
                  <h3>{activeQuestion.prompt}</h3>
                  {activeQuestion.model_text && <p className="quiz-model-text">{activeQuestion.model_text}</p>}
                  {activeQuestion.type === 'speaking_prompt' && activeQuestion.supporting_text && (
                    <div className="quiz-pinyin-reveal">
                      <button className="btn-quiet" type="button" onClick={() => setShowQuizPinyin((value) => !value)}>
                        {showQuizPinyin ? 'Hide pinyin' : 'Show pinyin'}
                      </button>
                      {showQuizPinyin && <p>{activeQuestion.supporting_text}</p>}
                    </div>
                  )}

                  {['multiple_choice', 'audio_choice', 'gap_fill_choice'].includes(activeQuestion.type) ? (
                    <div className="quiz-choice-grid">
                      {activeQuestion.choices.map((choice) => (
                        <button
                          key={choice}
                          type="button"
                          className={quizAnswers[activeQuestion.id] === choice ? 'selected' : ''}
                          onClick={() => answerQuizQuestion(activeQuestion.id, choice)}
                        >
                          {choice}
                        </button>
                      ))}
                    </div>
                  ) : activeQuestion.type === 'sequence' ? (
                    <div className="quiz-sequence-builder">
                      <div
                        className="quiz-sequence-answer"
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => handleSequenceDrop(event, activeQuestion.id, getSequenceAnswer(activeQuestion.id).length)}
                      >
                        {getSequenceAnswer(activeQuestion.id).length > 0 ? (
                          getSequenceAnswer(activeQuestion.id).map((choice, index) => (
                            <span
                              key={`${choice}-${index}`}
                              draggable
                              onDragStart={(event) => event.dataTransfer.setData('text/plain', choice)}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => handleSequenceDrop(event, activeQuestion.id, index)}
                            >
                              {index + 1}. {choice}
                            </span>
                          ))
                        ) : (
                          <span className="sequence-placeholder">Drag events here in story order.</span>
                        )}
                      </div>
                      <div className="quiz-choice-grid quiz-sequence-source">
                        {activeQuestion.choices.map((choice) => (
                          <button
                            key={choice}
                            type="button"
                            draggable={!getSequenceAnswer(activeQuestion.id).includes(choice)}
                            onDragStart={(event) => event.dataTransfer.setData('text/plain', choice)}
                            className={getSequenceAnswer(activeQuestion.id).includes(choice) ? 'selected' : ''}
                            disabled={getSequenceAnswer(activeQuestion.id).includes(choice)}
                            onClick={() => addSequenceChoice(activeQuestion.id, choice)}
                          >
                            {choice}
                          </button>
                        ))}
                      </div>
                      <button className="btn-quiet" type="button" onClick={() => clearSequenceAnswer(activeQuestion.id)}>
                        Clear order
                      </button>
                    </div>
                  ) : activeQuestion.type === 'speaking_prompt' ? (
                    <div className="quiz-speaking-card">
                      <p>Say the sentence aloud, then mark it practiced when you have repeated it.</p>
                      <button
                        type="button"
                        className={quizAnswers[activeQuestion.id] === 'practiced' ? 'selected' : ''}
                        onClick={() => answerQuizQuestion(activeQuestion.id, 'practiced')}
                      >
                        I said it aloud
                      </button>
                    </div>
                  ) : (
                    <label className="quiz-fill-answer">
                      Answer
                      <input
                        value={quizAnswers[activeQuestion.id] || ''}
                        onChange={(event) => answerQuizQuestion(activeQuestion.id, event.target.value)}
                        placeholder="Type the English translation"
                      />
                    </label>
                  )}

                  <div className="quiz-nav-row">
                    <button className="quiz-arrow btn-quiet" type="button" onClick={previousQuizQuestion} disabled={quizIndex === 0}>‹</button>
                    {quizIndex < quizQuestionCount - 1 ? (
                      <button className="btn-primary" type="button" onClick={nextQuizQuestion}>Next</button>
                    ) : (
                      <button className="btn-primary" type="button" onClick={submitQuiz} disabled={quizAnsweredCount < quizQuestionCount || quizLoading}>
                        {quizLoading ? 'Submitting...' : 'Submit quiz'}
                      </button>
                    )}
                    <button className="quiz-arrow btn-quiet" type="button" onClick={nextQuizQuestion} disabled={quizIndex >= quizQuestionCount - 1}>›</button>
                  </div>
                  {quizAnsweredCount < quizQuestionCount && quizIndex === quizQuestionCount - 1 && (
                    <p className="quiz-submit-note">Answer every question to submit this quiz.</p>
                  )}
                </article>
              ) : (
                <p className="status-line">Loading quiz...</p>
              )}
            </>
          ) : (
            <>
              <div className="quiz-header">
                <div>
                  <h2>Quizzes</h2>
                  <p>One story at a time, with listening, reading, speaking, sequencing, and Mandarin gap-fill checks.</p>
                </div>
                <button className="btn-quiet" type="button" onClick={refreshQuizDashboard} disabled={quizLoading}>Refresh</button>
              </div>

              {quizDashboard ? (
                <>
                  <section className="quiz-metrics-grid">
                    <article>
                      <span>Quizzes passed</span>
                      <strong>{quizDashboard.metrics.quizzes_passed}</strong>
                      <div className="quiz-meter"><span style={{ width: `${quizPassPercent}%` }} /></div>
                      <small>{quizPassPercent}% of story quizzes at 97%+</small>
                    </article>
                    <article>
                      <span>Average score</span>
                      <strong>{quizDashboard.metrics.average_score}%</strong>
                      <div className="quiz-meter"><span style={{ width: `${quizDashboard.metrics.average_score}%` }} /></div>
                      <small>Across recorded attempts</small>
                    </article>
                    <article>
                      <span>Available quizzes</span>
                      <strong>{quizDashboard.metrics.available_quizzes}</strong>
                      <div className="quiz-meter"><span style={{ width: '100%' }} /></div>
                      <small>One quiz for each story</small>
                    </article>
                  </section>

                  <div className="quiz-layout">
                    <section className="quiz-list-panel">
                      {quizLevelOrder.map((level) => (
                        <div key={level} className="quiz-level-group">
                          <h3>{level}</h3>
                          <div className="quiz-card-grid">
                            {(quizStoriesByLevel[level] || []).map((quizStory) => {
                              const passed = quizStory.best_attempt?.score_percent >= 97
                              return (
                                <article key={quizStory.id} className={`quiz-story-card ${passed ? 'passed' : ''}`}>
                                  <div>
                                    <span className="badge muted">{quizStory.question_count} questions</span>
                                    {passed && <span className="badge">97%+</span>}
                                  </div>
                                  <h4 title={quizStory.title_english || ''}>{quizStory.display_title || quizStory.title}</h4>
                                  <small>{quizStory.title_pinyin}</small>
                                  <p>
                                    {quizStory.best_attempt
                                      ? `Best score: ${quizStory.best_attempt.score_percent}% · ${formatSeconds(quizStory.best_attempt.elapsed_seconds)}`
                                      : 'No attempts yet'}
                                  </p>
                                  <button className={passed ? 'btn-quiet' : 'btn-primary'} type="button" onClick={() => startQuiz(quizStory.id)} disabled={quizLoading}>
                                    {quizStory.best_attempt ? 'Retake' : 'Start quiz'}
                                  </button>
                                </article>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </section>

                    <aside className="quiz-recent-panel">
                      <h3>Recent attempts</h3>
                      {quizDashboard.recent_attempts.length > 0 ? (
                        <div className="quiz-recent-list">
                          {quizDashboard.recent_attempts.map((attempt) => {
                            const attemptStory = quizStoryById[attempt.story_id]
                            return (
                              <article key={attempt.id} className={attempt.passed ? 'passed' : ''}>
                                <strong>{attempt.score_percent}%</strong>
                                <span>{attemptStory?.display_title || 'Story quiz'}</span>
                                <small>{attempt.correct_count}/{attempt.total_questions} correct · {formatSeconds(attempt.elapsed_seconds)}</small>
                              </article>
                            )
                          })}
                        </div>
                      ) : (
                        <p className="profile-note">No quiz attempts yet.</p>
                      )}
                    </aside>
                  </div>
                </>
              ) : (
                <p className="status-line">Loading quizzes...</p>
              )}
            </>
          )}
        </section>
      )}

      {view === 'practice' && (
        <section className="practice-shell practice-reader">
          <div className="practice-header">
            <h2>Flashcard Practice Mode</h2>
            <div className="practice-controls">
              <label>
                Practice set
                <select value={practiceFilter} onChange={(e) => { setPracticeFilter(e.target.value); setPracticeIndex(0) }}>
                  <option value="due">Due now</option>
                  <option value="all">Practice all words</option>
                  <option value="unknown">Practice unknown words</option>
                  <option value="known">Known words</option>
                  <option value="leitner">Leitner Mode</option>
                  <option value="rating:again">Difficulty: Again</option>
                  <option value="rating:hard">Difficulty: Hard</option>
                  <option value="rating:good">Difficulty: Good</option>
                  <option value="rating:easy">Difficulty: Easy</option>
                </select>
              </label>
              <div className="direction-toggle" aria-label="Practice direction">
                <span>{isLeitnerMode ? 'Leitner direction' : 'Practice direction'}</span>
                <div>
                  <button
                    type="button"
                    className={(isLeitnerMode ? activePracticeDirection : practiceDirection) === 'zh-en' ? 'active' : ''}
                    onClick={() => setPracticeDirection('zh-en')}
                    disabled={isLeitnerMode}
                  >
                    Mandarin → English
                  </button>
                  <button
                    type="button"
                    className={(isLeitnerMode ? activePracticeDirection : practiceDirection) === 'en-zh' ? 'active' : ''}
                    onClick={() => setPracticeDirection('en-zh')}
                    disabled={isLeitnerMode}
                  >
                    English → Mandarin
                  </button>
                </div>
                {isLeitnerMode && <small>Automatic: Mandarin → English first, then English → Mandarin.</small>}
              </div>
            </div>
          </div>

          {isLeitnerMode && !leitnerSessionStarted && !sessionComplete ? (
            <section className="leitner-panel">
              <div className="leitner-overview">
                <article>
                  <span>Due today</span>
                  <strong>{leitnerTodayCards.length}</strong>
                </article>
                <article>
                  <span>Selected day</span>
                  <strong>{leitnerSelectedDay?.total || 0}</strong>
                </article>
                <article>
                  <span>Leitner cards</span>
                  <strong>{flashcards.length}</strong>
                </article>
                <article>
                  <span>Mastered both ways</span>
                  <strong>{leitnerMasteredCards}</strong>
                </article>
              </div>

              <div className="leitner-layout">
                <section className="leitner-calendar-panel">
                  <div className="section-heading-row">
                    <h3>Calendar</h3>
                    <button className="btn-primary" type="button" onClick={() => startLeitnerSession(leitnerTodayCards)} disabled={leitnerTodayCards.length === 0}>
                      Study due today
                    </button>
                  </div>
                  <div className="leitner-calendar">
                    {leitnerCalendarDays.map((day) => (
                      <button
                        key={day.key}
                        type="button"
                        className={`leitner-day ${day.key === leitnerSelectedDate ? 'active' : ''}`}
                        onClick={() => setLeitnerSelectedDate(day.key)}
                      >
                        <span>{day.label}</span>
                        <strong>{day.total}</strong>
                        <div>
                          {day.boxes.filter((box) => box.count > 0).map((box) => (
                            <small key={box.box}>B{box.box}: {box.count}</small>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>

                <aside className="leitner-selected-panel">
                  <h3>{shortDateLabel(leitnerSelectedDate)}</h3>
                  <p>{availablePracticeDeck.length} scheduled card{availablePracticeDeck.length === 1 ? '' : 's'}</p>
                  <button className="btn-primary" type="button" onClick={() => startLeitnerSession(availablePracticeDeck)} disabled={availablePracticeDeck.length === 0}>
                    Study selected day
                  </button>
                  <div className="leitner-selected-list">
                    {LEITNER_BOXES.map(({ box }) => {
                      const count = availablePracticeDeck.filter((card) => getLeitnerBox(card) === box).length
                      return count > 0 ? <span key={box}>Box {box}: {count}</span> : null
                    })}
                    {availablePracticeDeck.length === 0 && <span>No cards scheduled.</span>}
                  </div>
                </aside>
              </div>

              <section className="leitner-box-grid">
                {leitnerBoxSummaries.map((box) => (
                  <article key={box.box} className="leitner-box-card">
                    <div>
                      <h3>{box.label}</h3>
                      <p>{box.interval}</p>
                    </div>
                    <strong>{box.total}</strong>
                    <span>{box.dueCards.length} due</span>
                    <button className="btn-quiet" type="button" onClick={() => startLeitnerSession(box.dueCards)} disabled={box.dueCards.length === 0}>
                      Study box
                    </button>
                  </article>
                ))}
              </section>
            </section>
          ) : sessionComplete ? (
            <div className="practice-session-grid is-empty">
              <button
                className="practice-tracker incorrect"
                type="button"
                onClick={() => setActiveReviewList('incorrect')}
              >
                <span>Incorrect</span>
                <strong>{incorrectCards.length}</strong>
              </button>

              <article className="practice-empty practice-finished-card">
                <p className="practice-count">End of flashcard deck · {practiceFilterLabel}</p>
                <h3>Final score: {scorePercent}%</h3>
                <p>{correctCards.length} correct out of {practiceDeck.length} cards</p>
                <div className="score-breakdown">
                  {Object.entries(ratingLabels).map(([rating, label]) => (
                    <span key={rating}>{label}: {ratingBreakdown[rating] || 0}</span>
                  ))}
                </div>
                <div className="end-deck-actions">
                  <button className="btn-primary" type="button" onClick={() => resetPracticeSession(practiceDeck.length ? practiceDeck : availablePracticeDeck)}>Start over</button>
                  <button className="btn-quiet" type="button" onClick={startIncorrectReview} disabled={incorrectCards.length === 0}>Review incorrect cards</button>
                  <label>
                    Study difficulty
                    <select value={studyDifficulty} onChange={(event) => setStudyDifficulty(event.target.value)}>
                      <option value="again">Again</option>
                      <option value="hard">Hard</option>
                      <option value="good">Good</option>
                      <option value="easy">Easy</option>
                    </select>
                  </label>
                  <button className="btn-quiet" type="button" onClick={startDifficultyReview} disabled={!practiceDeck.some((card) => reviewedRatings[card.id] === studyDifficulty)}>
                    Study difficulty
                  </button>
                </div>
              </article>

              <button
                className="practice-tracker correct"
                type="button"
                onClick={() => setActiveReviewList('correct')}
              >
                <span>Correct</span>
                <strong>{correctCards.length}</strong>
              </button>
            </div>
          ) : activePracticeCard ? (
            <>
              <div className="practice-session-grid">
                <button
                  className="practice-tracker incorrect"
                  type="button"
                  onClick={() => setActiveReviewList('incorrect')}
                >
                  <span>Incorrect</span>
                  <strong>{incorrectCards.length}</strong>
                </button>

                <div className="flashcard-stage">
                  <button
                    className="practice-arrow left btn-quiet"
                    type="button"
                    aria-label="Previous card"
                    onClick={previousPracticeCard}
                    disabled={flyDirection}
                  >
                    ‹
                  </button>

                  <article
                    className={`practice-flashcard ${showAnswer ? 'is-flipped' : ''} ${flyDirection ? `fly-${flyDirection}` : ''}`}
                    onClick={handleFlipPracticeCard}
                    role="button"
                    tabIndex={0}
                    aria-label="Flip flashcard"
                  >
                    <div className="practice-flashcard-inner">
                      <div className="practice-face practice-front">
                        <p className="practice-count">Card {Math.min(answeredCount + 1, practiceDeck.length)} of {practiceDeck.length}</p>
                        <span className="direction-badge">{directionLabels[activePracticeDirection]}</span>
                        <h3 className={`practice-word ${activePracticeDirection === 'en-zh' ? 'english-prompt' : ''}`}>{activePracticeContent.frontMain}</h3>
                        {activePracticeContent.frontSub && <p className="practice-pinyin">{activePracticeContent.frontSub}</p>}
                        <div className="practice-audio-row">
                          <button
                            className="audio-button btn-quiet"
                            type="button"
                            aria-label={activePracticeContent.frontAudioLabel}
                            onClick={(event) => handleAudioClick(event, activePracticeContent.frontAudioText, activePracticeContent.frontAudioLang)}
                          >
                            {activePracticeContent.frontAudioLabel}
                          </button>
                        </div>
                        <p className="practice-hint">{activePracticeContent.frontHint}</p>
                      </div>

                      <div className="practice-face practice-back">
                        <p className="practice-count">{activePracticeContent.backCount}</p>
                        <p className={`practice-answer-large ${activePracticeDirection === 'en-zh' ? 'chinese-answer' : ''}`}>{activePracticeContent.backMain}</p>
                        {activePracticeContent.backSub && <p className="practice-pinyin">{activePracticeContent.backSub}</p>}
                        {activePracticeCard.context_sentence && (
                          <div className="card-context example-sentence">
                            <span>Example sentence</span>
                            <strong>{activePracticeCard.context_sentence}</strong>
                            {activePracticeCard.context_sentence_pinyin && <small>{activePracticeCard.context_sentence_pinyin}</small>}
                            {activePracticeCard.context_sentence_english && <p>{activePracticeCard.context_sentence_english}</p>}
                          </div>
                        )}
                        <div className="practice-audio-row">
                          <button
                            className="audio-button btn-quiet"
                            type="button"
                            aria-label={activePracticeContent.backAudioLabel}
                            onClick={(event) => handleAudioClick(event, activePracticeContent.backAudioText, activePracticeContent.backAudioLang)}
                          >
                            {activePracticeContent.backAudioLabel}
                          </button>
                        </div>
                        <p className="practice-count">
                          {isLeitnerMode
                            ? `Leitner Box ${getLeitnerBox(activePracticeCard)} · ${directionLabels[activePracticeDirection]} ${activeDirectionProgress}/${activeMasteryThreshold} · Both directions ${activePracticeCard.leitner_mastered ? 'mastered' : 'in progress'}`
                            : `Status: ${activePracticeCard.status} · Reviews: ${activePracticeCard.review_count}`}
                        </p>
                      </div>
                    </div>
                  </article>

                  <button
                    className="practice-arrow right btn-quiet"
                    type="button"
                    aria-label="Next card"
                    onClick={nextPracticeCard}
                    disabled={flyDirection}
                  >
                    ›
                  </button>
                </div>

                <button
                  className="practice-tracker correct"
                  type="button"
                  onClick={() => setActiveReviewList('correct')}
                >
                  <span>Correct</span>
                  <strong>{correctCards.length}</strong>
                </button>
              </div>

              <div className="practice-primary-actions" aria-label="Practice rating controls">
                <button className="btn-danger practice-rate incorrect" type="button" onClick={handleMarkIncorrect} disabled={flyDirection}>
                  Incorrect
                </button>
                <button className="btn-primary" type="button" onClick={handleFlipPracticeCard} disabled={flyDirection}>
                  {showAnswer ? 'Show Front' : 'Flip'}
                </button>
                <button className="btn-primary practice-rate correct" type="button" onClick={handleMarkCorrect} disabled={flyDirection}>
                  Correct
                </button>
              </div>

              <details className="advanced-rating">
                <summary>Advanced rating</summary>
                <div className="practice-actions secondary">
                  <button className="btn-danger" type="button" onClick={() => markPracticeCard(activePracticeCard, 'again', 'left', 'Incorrect')} disabled={flyDirection}>Again</button>
                  <button className="btn-danger" type="button" onClick={() => markPracticeCard(activePracticeCard, 'hard', 'left', 'Incorrect')} disabled={flyDirection}>Hard</button>
                  <button className="btn-quiet" type="button" onClick={() => markPracticeCard(activePracticeCard, 'good', 'right', 'Correct')} disabled={flyDirection}>Good</button>
                  <button className="btn-primary" type="button" onClick={() => markPracticeCard(activePracticeCard, 'easy', 'right', 'Correct')} disabled={flyDirection}>Easy</button>
                </div>
              </details>

            </>
          ) : (
            <div className="practice-session-grid is-empty">
              <button
                className="practice-tracker incorrect"
                type="button"
                onClick={() => setActiveReviewList('incorrect')}
              >
                <span>Incorrect</span>
                <strong>{incorrectCards.length}</strong>
              </button>

              <article className="practice-empty">
                <h3>No cards available for this practice set.</h3>
                <p>Try saving flashcards in the reader, or switch to "Practice all words".</p>
              </article>

              <button
                className="practice-tracker correct"
                type="button"
                onClick={() => setActiveReviewList('correct')}
              >
                <span>Correct</span>
                <strong>{correctCards.length}</strong>
              </button>
            </div>
          )}

          {toastMessage && <div className={`practice-toast ${toastMessage === 'Correct' ? 'correct' : 'incorrect'}`}>{toastMessage}</div>}

          {activeReviewList && (
            <div className="practice-review-modal" onClick={() => setActiveReviewList(null)}>
              <aside className="practice-review-panel" onClick={(event) => event.stopPropagation()}>
                <div className="practice-review-header">
                  <h3>{reviewListTitle}</h3>
                  <button className="btn-quiet" type="button" onClick={() => setActiveReviewList(null)}>Close</button>
                </div>
                {reviewListCards.length > 0 ? (
                  <div className="practice-review-list">
                    {reviewListCards.map((card, index) => (
                      <article className="practice-review-item" key={`${card.id}-${index}`}>
                        <strong>{card.source_text}</strong>
                        <small>{card.pinyin || 'No pinyin available'}</small>
                        <p>{card.translation}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="review-empty">{reviewListEmpty}</p>
                )}
              </aside>
            </div>
          )}
        </section>
      )}

      {view === 'profile' && profile && (
        <section className="profile-shell">
          <h2>Learning profile</h2>
          <div className="profile-grid">
            <label>
              Current level
              <select value={profile.current_level} onChange={(e) => changeLevel(e.target.value)}>
                {levels.map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </label>
            <label>
              Goal
              <select value={profile.goal} onChange={async (e) => {
                const data = await api('/api/profile', 'PATCH', token, { goal: e.target.value })
                setProfile(data.profile)
              }}>
                <option value="reading">Reading</option>
                <option value="travel">Travel</option>
                <option value="class support">Class support</option>
                <option value="HSK">HSK</option>
              </select>
            </label>
            <label>
              Daily review goal
              <input
                type="number"
                min="1"
                max="120"
                value={profile.daily_goal}
                onChange={async (e) => {
                  const data = await api('/api/profile', 'PATCH', token, { daily_goal: Number(e.target.value) })
                  setProfile(data.profile)
                }}
              />
            </label>
          </div>
          <p className="profile-note">Progress is now attached to your account: saved items, review status, lookup count, and completed stories travel with your login.</p>
          <section className="flashcard-history">
            <h3>Flashcard history</h3>
            {profile.flashcard_history?.length > 0 ? (
              <div className="history-list">
                {profile.flashcard_history.map((session) => (
                  <article key={session.id} className="history-item">
                    <strong>{session.score_percent}%</strong>
                    <span>{session.correct_count}/{session.total_cards} correct · {formatPracticeFilter(session.practice_filter)}</span>
                    <small>{session.created_at ? new Date(session.created_at).toLocaleString() : 'Recent session'}</small>
                  </article>
                ))}
              </div>
            ) : (
              <p className="profile-note">No flashcard sessions recorded yet.</p>
            )}
          </section>
        </section>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  )
}
