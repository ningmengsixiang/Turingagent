import { useEffect, useState } from 'react'
import { clearToken, getToken } from './api/client.js'
import { Login } from './pages/Login.js'
import { Chat } from './pages/Chat.js'

export function App() {
  const [authed, setAuthed] = useState<boolean>(() => getToken() !== null)

  useEffect(() => {
    // 401 时清 token 并回到登录页
    const onUnauthorized = () => setAuthed(false)
    window.addEventListener('ta:unauthorized', onUnauthorized)
    return () => window.removeEventListener('ta:unauthorized', onUnauthorized)
  }, [])

  if (!authed) {
    return <Login onAuthed={() => setAuthed(true)} />
  }
  return <Chat onLogout={() => { clearToken(); setAuthed(false) }} />
}
