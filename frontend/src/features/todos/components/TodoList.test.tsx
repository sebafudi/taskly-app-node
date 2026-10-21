import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { TodoList } from './TodoList'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('./TodoEmptyState', () => ({
  TodoEmptyState: ({
    hasTodos,
    disabled,
    onCreate,
  }: {
    hasTodos: boolean
    disabled: boolean
    onCreate: () => void
  }) => (
    <div>
      <p>Empty task list</p>
      <button disabled={disabled} onClick={onCreate}>
        {hasTodos ? 'No match' : 'Create'}
      </button>
    </div>
  ),
}))
vi.mock('./TodoItem', () => ({
  TodoItem: ({
    todo,
    busy,
    onToggle,
    onEdit,
    onDelete,
  }: {
    todo: Todo
    busy: boolean
    onToggle: () => void
    onEdit: () => void
    onDelete: () => void
  }) => (
    <li>
      {todo.title}
      <button disabled={busy} onClick={onToggle}>
        Toggle {todo.title}
      </button>
      <button onClick={onEdit}>Edit {todo.title}</button>
      <button onClick={onDelete}>Delete {todo.title}</button>
    </li>
  ),
}))

function props() {
  return {
    todos: [] as Todo[],
    hasTodos: false,
    loading: false,
    failed: false,
    busy: false,
    onCreate: vi.fn(),
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  }
}

it('shows loading feedback before showing an empty list', () => {
  const props = {
    todos: [],
    hasTodos: false,
    failed: false,
    busy: false,
    onCreate: vi.fn(),
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  }
  const { rerender } = render(<TodoList {...props} loading />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading your tasks…')
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
  rerender(<TodoList {...props} loading={false} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByText('Empty task list')).toBeVisible()
})

it('renders each task and forwards its actions with that task', async () => {
  const user = userEvent.setup()
  const second: Todo = { ...todoFixture, id: 8, title: 'Review notes' }
  const base = props()
  render(<TodoList {...base} todos={[todoFixture, second]} hasTodos />)
  expect(screen.getByRole('region', { name: 'Task list' })).toBeVisible()
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  await user.click(screen.getByRole('button', { name: 'Toggle Review notes' }))
  expect(base.onToggle).toHaveBeenCalledWith(second)
  await user.click(
    screen.getByRole('button', { name: `Edit ${todoFixture.title}` }),
  )
  expect(base.onEdit).toHaveBeenCalledWith(todoFixture)
  await user.click(screen.getByRole('button', { name: 'Delete Review notes' }))
  expect(base.onDelete).toHaveBeenCalledWith(second)
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
})

it('passes the busy state down to each task', () => {
  render(<TodoList {...props()} todos={[todoFixture]} hasTodos busy />)
  expect(
    screen.getByRole('button', { name: `Toggle ${todoFixture.title}` }),
  ).toBeDisabled()
})

it('shows an unavailable message when loading failed and nothing is cached', () => {
  render(<TodoList {...props()} failed />)
  expect(
    screen.getByRole('heading', {
      name: 'The task list is temporarily unavailable',
    }),
  ).toBeVisible()
  expect(screen.getByText('Try again to load your tasks.')).toBeVisible()
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
})

it('keeps showing cached tasks when a refetch failed', () => {
  render(<TodoList {...props()} todos={[todoFixture]} hasTodos failed />)
  expect(screen.getByText(todoFixture.title)).toBeVisible()
  expect(
    screen.queryByText('The task list is temporarily unavailable'),
  ).not.toBeInTheDocument()
})

it('shows the filtered empty state and wires its create action', async () => {
  const user = userEvent.setup()
  const base = props()
  const { rerender } = render(<TodoList {...base} busy />)
  expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  rerender(<TodoList {...base} />)
  await user.click(screen.getByRole('button', { name: 'Create' }))
  expect(base.onCreate).toHaveBeenCalledTimes(1)
  rerender(<TodoList {...base} hasTodos />)
  expect(screen.getByRole('button', { name: 'No match' })).toBeVisible()
})
