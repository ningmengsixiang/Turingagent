import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button, Badge, Modal, ProgressBar, Spinner, Avatar, Chip, EmptyState, Toast, Skeleton, Input, TextArea } from './index.js'

describe('ui kit', () => {
  it('renders Button variants', () => {
    const { rerender } = render(<Button variant="primary">保存</Button>)
    expect(screen.getByRole('button', { name: '保存' }).className).toContain('primary')
    rerender(<Button variant="danger" size="sm">删除</Button>)
    expect(screen.getByRole('button', { name: '删除' }).className).toContain('danger sm')
  })

  it('renders Badge with variant class', () => {
    render(<Badge variant="success">已通过</Badge>)
    expect(screen.getByText('已通过').className).toContain('success')
  })

  it('renders Modal only when open', () => {
    const { rerender } = render(<Modal open={false} title="测试">内容</Modal>)
    expect(screen.queryByText('内容')).toBeNull()
    rerender(<Modal open title="测试">内容</Modal>)
    expect(screen.getByText('内容')).toBeTruthy()
    expect(screen.getByText('测试')).toBeTruthy()
  })

  it('renders ProgressBar with clamped width', () => {
    render(<ProgressBar ratio={1.5} />)
    const fill = document.querySelector('.ui-progress-fill') as HTMLElement
    expect(fill.style.width).toBe('100%')
  })

  it('renders Spinner, Avatar, Chip, EmptyState, Toast, Skeleton, Input, TextArea', () => {
    render(<Spinner />)
    expect(screen.getByRole('status')).toBeTruthy()
    render(<Avatar name="Alice" />)
    expect(screen.getByText('A')).toBeTruthy()
    render(<Avatar name="Ta-PM" kind="agent" />)
    expect(screen.getByText('🤖')).toBeTruthy()
    render(<Chip>全栈</Chip>)
    expect(screen.getByText('全栈')).toBeTruthy()
    render(<EmptyState>暂无数据</EmptyState>)
    expect(screen.getByText('暂无数据')).toBeTruthy()
    render(<Toast toasts={[{ id: 1, variant: 'success', content: '保存成功' }]} />)
    expect(screen.getByText('保存成功')).toBeTruthy()
    render(<Skeleton />)
    expect(document.querySelector('.ui-skeleton')).toBeTruthy()
    render(<Input placeholder="搜索" />)
    expect(screen.getByPlaceholderText('搜索')).toBeTruthy()
    render(<TextArea placeholder="内容" />)
    expect(screen.getByPlaceholderText('内容')).toBeTruthy()
  })
})
