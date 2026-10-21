import { it, expect } from 'vitest';
import { summarize } from '../src/features/todos/stats.ts';
import { todo } from './fixture.ts';

it('counts active, completed, overdue and due-today tasks', () => {
  const todos = [
    { ...todo, id: 1, due_date: '2026-10-19' },
    { ...todo, id: 2, due_date: '2026-10-20' },
    { ...todo, id: 3, due_date: '2026-10-21' },
    { ...todo, id: 4, due_date: null },
    { ...todo, id: 5, due_date: '2026-10-01', completed: true },
  ];
  expect(summarize(todos, '2026-10-20')).toEqual({ total: 5, active: 4, completed: 1, overdue: 1, dueToday: 1 });
});
it('returns zeros for an empty list', () => {
  expect(summarize([], '2026-10-20')).toEqual({ total: 0, active: 0, completed: 0, overdue: 0, dueToday: 0 });
});
