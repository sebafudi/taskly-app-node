import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { TodoSummary } from './TodoSummary'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

afterEach(() => vi.useRealTimers())

it('shows counts and omits the overdue part when nothing is overdue', () => {
  render(
    <TodoSummary
      todos={[todoFixture, { ...todoFixture, id: 8, completed: true }]}
    />,
  )
  expect(screen.getByRole('status')).toHaveTextContent('1 to do · 1 completed')
  expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
})

it('adds the overdue count when tasks are overdue', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-20T10:00:00'))
  render(<TodoSummary todos={[{ ...todoFixture, due_date: '2026-10-19' }]} />)
  expect(screen.getByRole('status')).toHaveTextContent(
    '1 to do · 0 completed · 1 overdue',
  )
})
