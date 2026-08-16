import { useState } from 'react'
import { login } from '../api/client.js'
import { Spinner } from '../ui/Spinner.js'

export interface LoginProps {
  onAuthed: (name: string) => void
}

export function Login({ onAuthed }: LoginProps) {
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!username.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await login(username.trim())
      onAuthed(res.user.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>Turing Agent</h1>
        <p className="login-sub">与智能体团队协作的软件交付工作台</p>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="用户名（演示登录，任意名字）"
          autoFocus
        />
        {error && <p className="login-error">{error}</p>}
        <button type="submit" disabled={busy || !username.trim()}>
          {busy ? <Spinner size="sm" /> : '登录'}
        </button>
      </form>
    </div>
  )
}
