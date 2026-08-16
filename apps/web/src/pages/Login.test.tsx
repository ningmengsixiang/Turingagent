import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Login } from './Login.js'

describe('Login', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('renders and logs in on submit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 'jwt', user: { id: 'u-alice', name: 'alice' } }),
    }))
    const onAuthed = vi.fn()
    render(<Login onAuthed={onAuthed} />)
    await userEvent.type(screen.getByPlaceholderText(/用户名/), 'alice')
    await userEvent.click(screen.getByRole('button', { name: /登录/ }))
    expect(onAuthed).toHaveBeenCalledWith('alice')
    expect(localStorage.getItem('ta.token')).toBe('jwt')
  })

  it('shows an error on failed login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    }))
    render(<Login onAuthed={vi.fn()} />)
    await userEvent.type(screen.getByPlaceholderText(/用户名/), 'alice')
    await userEvent.click(screen.getByRole('button', { name: /登录/ }))
    expect(await screen.findByText('unauthorized')).toBeTruthy()
  })
})
