import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { useTheme } from './hooks/useTheme'
import LoginGate from './components/LoginGate'
import RegistrationDesk from './components/RegistrationDesk'
import AdminPanel from './components/AdminPanel'

const SESSION_KEY = 'event-app-desk-session' // { deskNumber, sessionToken, operatorName }
const ADMIN_KEY = 'event-app-admin-code'

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const [view, setView] = useState('loading') // 'loading' | 'login' | 'desk' | 'admin'
  const [deskSession, setDeskSession] = useState(null)
  const [adminCode, setAdminCode] = useState(null)

  useEffect(() => {
    const storedAdmin = sessionStorage.getItem(ADMIN_KEY)
    if (storedAdmin) {
      setAdminCode(storedAdmin)
      setView('admin')
      return
    }

    const stored = sessionStorage.getItem(SESSION_KEY)
    if (!stored) {
      setView('login')
      return
    }

    const parsed = JSON.parse(stored)
    supabase.rpc('resume_desk_session', { p_session_token: parsed.sessionToken }).then(({ data, error }) => {
      if (error || !data?.valid) {
        sessionStorage.removeItem(SESSION_KEY)
        setView('login')
      } else {
        const operatorName = data.operator_name || parsed.operatorName
        setDeskSession({ deskNumber: data.desk_number, sessionToken: parsed.sessionToken, operatorName })
        setView('desk')
      }
    })
  }, [])

  function handleDeskLogin({ deskNumber, sessionToken, operatorName }) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ deskNumber, sessionToken, operatorName }))
    setDeskSession({ deskNumber, sessionToken, operatorName })
    setView('desk')
  }

  function handleAdminLogin(code) {
    sessionStorage.setItem(ADMIN_KEY, code)
    setAdminCode(code)
    setView('admin')
  }

  function handleDeskLogout() {
    sessionStorage.removeItem(SESSION_KEY)
    setDeskSession(null)
    setView('login')
  }

  function handleAdminLogout() {
    sessionStorage.removeItem(ADMIN_KEY)
    setAdminCode(null)
    setView('login')
  }

  if (view === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper dark:bg-ink-950 text-ink-500 dark:text-ink-400 font-display">
        {'Loading…'}
      </div>
    )
  }

  if (view === 'desk' && deskSession) {
    return (
      <RegistrationDesk
        deskNumber={deskSession.deskNumber}
        sessionToken={deskSession.sessionToken}
        operatorName={deskSession.operatorName}
        onLogout={handleDeskLogout}
        theme={theme}
        toggleTheme={toggleTheme}
      />
    )
  }

  if (view === 'admin' && adminCode) {
    return <AdminPanel adminCode={adminCode} onLogout={handleAdminLogout} theme={theme} toggleTheme={toggleTheme} />
  }

  return (
    <LoginGate onDeskLogin={handleDeskLogin} onAdminLogin={handleAdminLogin} theme={theme} toggleTheme={toggleTheme} />
  )
}
