import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Lock, Moon, Sun } from 'lucide-react'

export default function LoginGate({ onDeskLogin, onAdminLogin, theme, toggleTheme }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!code.trim() || loading) return
    setLoading(true)
    setError('')

    const { data, error: rpcError } = await supabase.rpc('verify_access_code', { p_code: code.trim() })

    setLoading(false)

    if (rpcError) {
      setError('Could not reach the server. Check your connection and try again.')
      return
    }

    if (data?.role === 'admin') {
      onAdminLogin(code.trim())
    } else if (data?.role === 'desk') {
      onDeskLogin({ deskNumber: data.desk_number, sessionToken: data.session_token })
    } else {
      setError('Invalid access code.')
      setCode('')
      inputRef.current?.focus()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-900 transition-colors px-4">
      <button
        onClick={toggleTheme}
        aria-label="Toggle dark mode"
        className="absolute top-4 right-4 p-2 rounded-full text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800 dark:text-neutral-400 transition"
      >
        {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
      </button>

      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white dark:bg-neutral-800 rounded-2xl shadow-lg p-8 flex flex-col items-center gap-5"
      >
        <div className="w-12 h-12 rounded-full bg-neutral-900 dark:bg-white flex items-center justify-center">
          <Lock className="text-white dark:text-neutral-900" size={22} />
        </div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">Event Access</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 -mt-3 text-center">
          Enter your access code to continue
        </p>

        <input
          ref={inputRef}
          type="password"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Access code"
          className="w-full text-center text-lg tracking-widest px-4 py-3 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
        />

        {error && <p className="text-sm text-red-500 -mt-2">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium hover:opacity-90 transition disabled:opacity-50"
        >
          {loading ? 'Checking...' : 'Enter'}
        </button>
      </form>
    </div>
  )
}
