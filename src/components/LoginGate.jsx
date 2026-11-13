import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Moon, Sun, Ticket } from 'lucide-react'

export default function LoginGate({ onDeskLogin, onAdminLogin, theme, toggleTheme }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [shake, setShake] = useState(false)
  const codeRef = useRef(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!code.trim() || loading) return
    setLoading(true)
    setError('')

    const { data, error: rpcError } = await supabase.rpc('verify_access_code', {
      p_code: code.trim(),
      p_name: name.trim() || null,
    })

    setLoading(false)

    if (rpcError) {
      setError('Could not reach the server. Check your connection and try again.')
      return
    }

    if (data?.role === 'admin') {
      onAdminLogin(code.trim())
    } else if (data?.role === 'desk') {
      onDeskLogin({ deskNumber: data.desk_number, sessionToken: data.session_token, operatorName: data.operator_name })
    } else {
      setError('That code doesn’t match anything. Double-check and try again.')
      setCode('')
      setShake(true)
      setTimeout(() => setShake(false), 400)
      codeRef.current?.focus()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper dark:bg-ink-950 transition-colors px-4 relative overflow-hidden">
      {/* soft ambient glow, single deliberate touch */}
      <div className="pointer-events-none absolute -top-32 -right-32 w-96 h-96 rounded-full bg-marigold-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-lagoon-500/20 blur-3xl" />

      <button
        onClick={toggleTheme}
        aria-label="Toggle dark mode"
        className="absolute top-5 right-5 p-2.5 rounded-full text-ink-500 dark:text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800 transition"
      >
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <form
        onSubmit={handleSubmit}
        className={`relative w-full max-w-sm bg-white dark:bg-ink-800 rounded-3xl shadow-xl shadow-ink-900/10 dark:shadow-black/30 p-8 flex flex-col gap-5 animate-ticket-in ${
          shake ? 'animate-shake' : ''
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-ink-900 dark:bg-marigold-500 flex items-center justify-center shrink-0 -rotate-3">
            <Ticket className="text-marigold-400 dark:text-ink-900" size={20} />
          </div>
          <div>
            <h1 className="font-display font-semibold text-lg text-ink-900 dark:text-white leading-tight">
              Event Check-In
            </h1>
            <p className="text-sm text-ink-500 dark:text-ink-400">Enter your details to continue</p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-ink-700 dark:text-ink-100">Your name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="So we know who's on each desk"
            autoFocus
            className="w-full px-4 py-3 rounded-xl border border-ink-100 dark:border-ink-700 bg-paper dark:bg-ink-900 text-ink-900 dark:text-white placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-marigold-500"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-ink-700 dark:text-ink-100">Access code</label>
          <input
            ref={codeRef}
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="••••••"
            className="w-full text-center text-lg tracking-[0.3em] px-4 py-3 rounded-xl border border-ink-100 dark:border-ink-700 bg-paper dark:bg-ink-900 text-ink-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-marigold-500"
          />
        </div>

        {error && <p className="text-sm text-flare-500 dark:text-flare-400 -mt-1">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 rounded-xl bg-ink-900 dark:bg-marigold-500 text-white dark:text-ink-900 font-display font-semibold tracking-tight hover:opacity-90 active:scale-[0.98] transition disabled:opacity-50"
        >
          {loading ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </div>
  )
}
