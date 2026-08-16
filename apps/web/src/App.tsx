import { useEffect, useState } from 'react'
import { getToken } from './api/client.js'
import { Login } from './pages/Login.js'
import { Chat } from './pages/Chat.js'

export function App() {
  const [authed, setAuthed] = useState<boolean>(() => getToken() !== null)

  useEffect(() => {
    if (!getToken()) setAuthed(false)
  }, [])

  if (!authed) {
    return <Login onAuthed={() => setAuthed(true)} />
  }
  return <Chat onLogout={() => { localStorage.removeItem('ta.token'); setAuthed(false) }} />
}
