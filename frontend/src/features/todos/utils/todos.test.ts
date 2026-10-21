import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatDate, isOverdue, selectTodos, validateTodo } from './todos'
import type { Todo } from '../types'

const base: Todo = {
  id: 1,
  title: 'Sprint plan',
  description: '',
  priority: 'medium',
  completed: false,
  due_date: null,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
}

describe('selectTodos', () => {
  it('combines status with a case-insensitive search in the description', () => {
    const matching = { ...base, description: 'Discuss the API' }
    const todos = [
      matching,
      { ...matching, id: 2, completed: true },
      { ...base, id: 3 },
    ]
    expect(selectTodos(todos, 'active', ' api ', 'newest')).toEqual([matching])
  })

  it('sorts by priority without changing the source array', () => {
    const high: Todo = { ...base, id: 2, priority: 'high' }
    const todos = [base, high]
    expect(selectTodos(todos, 'all', '', 'priority')).toEqual([high, base])
    expect(todos).toEqual([base, high])
  })
  it('sorts by due date with undated tasks last and newer ids first on ties', () => {
    const later: Todo = { ...base, id: 2, due_date: '2026-11-02' }
    const sooner: Todo = { ...base, id: 3, due_date: '2026-10-25' }
    const sameDay: Todo = { ...base, id: 4, due_date: '2026-10-25' }
    expect(
      selectTodos([base, later, sooner, sameDay], 'all', '', 'due'),
    ).toEqual([sameDay, sooner, later, base])
  })

  it('breaks priority and due date ties by newer id first', () => {
    const older: Todo = { ...base, id: 2, due_date: '2026-10-25' }
    const newer: Todo = { ...base, id: 3, due_date: '2026-10-25' }
    const undated: Todo = { ...base, id: 4 }
    expect(selectTodos([older, newer], 'all', '', 'priority')).toEqual([
      newer,
      older,
    ])
    expect(selectTodos([undated, older], 'all', '', 'due')).toEqual([
      older,
      undated,
    ])
    expect(selectTodos([older, undated], 'all', '', 'due')).toEqual([
      older,
      undated,
    ])
  })

  it('keeps only completed tasks and sorts newest first', () => {
    const older: Todo = { ...base, id: 2, completed: true }
    const newer: Todo = {
      ...base,
      id: 3,
      completed: true,
      created_at: '2026-10-05T12:00:00Z',
    }
    const sameTime: Todo = { ...base, id: 4, completed: true }
    expect(
      selectTodos([base, older, newer, sameTime], 'completed', '', 'newest'),
    ).toEqual([newer, sameTime, older])
  })
})

describe('validateTodo', () => {
  const input = {
    title: 'Plan',
    description: '',
    priority: 'low' as const,
    due_date: null,
    completed: false,
  }

  it('accepts a valid task with or without a due date', () => {
    expect(validateTodo(input)).toEqual({})
    expect(validateTodo({ ...input, due_date: '2024-02-29' })).toEqual({})
  })

  it('requires a title that is not only whitespace', () => {
    expect(validateTodo({ ...input, title: '  ' })).toEqual({
      title: 'Enter a task title.',
    })
  })

  it('limits the trimmed title to 120 characters', () => {
    expect(validateTodo({ ...input, title: ` ${'a'.repeat(120)} ` })).toEqual(
      {},
    )
    expect(validateTodo({ ...input, title: 'a'.repeat(121) })).toEqual({
      title: 'The title must be at most 120 characters.',
    })
  })

  it('limits the trimmed description to 2000 characters', () => {
    expect(
      validateTodo({ ...input, description: `${'d'.repeat(2000)}  ` }),
    ).toEqual({})
    expect(validateTodo({ ...input, description: 'd'.repeat(2001) })).toEqual({
      description: 'The description must be at most 2000 characters.',
    })
  })

  it.each(['2026-02-30', '2026-13-01', '26-10-20', '2026-1-05', 'tomorrow'])(
    'rejects the invalid due date %s',
    (due_date) => {
      expect(validateTodo({ ...input, due_date })).toEqual({
        due_date: 'Enter a valid date.',
      })
    },
  )

  it('reports every invalid field at once', () => {
    expect(
      validateTodo({
        ...input,
        title: '',
        description: 'd'.repeat(2001),
        due_date: 'x',
      }),
    ).toEqual({
      title: 'Enter a task title.',
      description: 'The description must be at most 2000 characters.',
      due_date: 'Enter a valid date.',
    })
  })
})

describe('isOverdue', () => {
  afterEach(() => vi.useRealTimers())

  it('flags only open tasks due before the local date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-20T10:00:00'))
    expect(isOverdue({ ...base, due_date: '2026-10-19' })).toBe(true)
    expect(isOverdue({ ...base, due_date: '2026-10-20' })).toBe(false)
    expect(isOverdue({ ...base, due_date: '2026-10-21' })).toBe(false)
    expect(isOverdue({ ...base, due_date: null })).toBe(false)
    expect(
      isOverdue({ ...base, due_date: '2026-10-19', completed: true }),
    ).toBe(false)
  })

  it('uses the local calendar day just after midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:30:00'))
    expect(isOverdue({ ...base, due_date: '2025-12-31' })).toBe(true)
    expect(isOverdue({ ...base, due_date: '2026-01-01' })).toBe(false)
  })
})

describe('formatDate', () => {
  it('formats an ISO date as day, short month and year', () => {
    expect(formatDate('2026-10-05')).toBe('5 Oct 2026')
    expect(formatDate('2026-01-31')).toBe('31 Jan 2026')
  })
})
