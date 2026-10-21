import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { useTodoFilters } from './useTodoFilters'

const done: Todo = { ...todoFixture, id: 8, title: 'Ship it', completed: true }
const high: Todo = {
  ...todoFixture,
  id: 9,
  title: 'Fix login',
  priority: 'high',
  created_at: '2026-09-01T12:00:00Z',
}
const todos = [todoFixture, done, high]

it('starts with every task, newest first', () => {
  const { result } = renderHook(() => useTodoFilters(todos))
  expect(result.current.filter).toBe('all')
  expect(result.current.search).toBe('')
  expect(result.current.sort).toBe('newest')
  expect(result.current.visible).toEqual([done, todoFixture, high])
})

it('applies the chosen filter, search and sort to the visible tasks', () => {
  const { result } = renderHook(() => useTodoFilters(todos))
  act(() => result.current.setFilter('active'))
  expect(result.current.visible).toEqual([todoFixture, high])
  act(() => result.current.setSort('priority'))
  expect(result.current.sort).toBe('priority')
  expect(result.current.visible).toEqual([high, todoFixture])
  act(() => result.current.setSearch('demo'))
  expect(result.current.search).toBe('demo')
  expect(result.current.visible).toEqual([todoFixture])
  act(() => result.current.setFilter('completed'))
  expect(result.current.visible).toEqual([])
})
