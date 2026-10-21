import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'
import { useCreateTodoMutation } from './useCreateTodoMutation'

vi.mock('../api/todos', () => ({
  todosApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))
beforeEach(() => vi.clearAllMocks())

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

it('prepends the created task to the cached list', async () => {
  const { client, wrapper } = setup()
  const existing: Todo = { ...todoFixture, id: 1, title: 'Older task' }
  const saved: Todo = { ...todoFixture, id: 8, title: 'New task' }
  client.setQueryData(todoKeys.list, [existing])
  vi.mocked(todosApi.create).mockResolvedValue(saved)
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  const input = {
    title: 'New task',
    description: '',
    priority: 'high' as const,
    due_date: null,
    completed: false,
  }
  await act(() => result.current.mutateAsync(input))
  expect(todosApi.create).toHaveBeenCalledWith(input)
  expect(client.getQueryData(todoKeys.list)).toEqual([saved, existing])
})

it('replaces a cached copy of the same task instead of duplicating it', async () => {
  const { client, wrapper } = setup()
  const stale: Todo = { ...todoFixture, title: 'Stale copy' }
  const other: Todo = { ...todoFixture, id: 2 }
  client.setQueryData(todoKeys.list, [stale, other])
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  await act(() => result.current.mutateAsync(todoFixture))
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture, other])
})

it('starts the cached list when nothing was loaded yet', async () => {
  const { client, wrapper } = setup()
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  await act(() => result.current.mutateAsync(todoFixture))
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})

it('leaves the cache untouched and exposes the error when creation fails', async () => {
  const { client, wrapper } = setup()
  client.setQueryData(todoKeys.list, [todoFixture])
  vi.mocked(todosApi.create).mockRejectedValue(new Error('Server error.'))
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  await act(() =>
    expect(result.current.mutateAsync(todoFixture)).rejects.toThrow(
      'Server error.',
    ),
  )
  expect(result.current.error?.message).toBe('Server error.')
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})
