import type { Todo } from './types.js';

export interface TodoStats {
  total: number;
  active: number;
  completed: number;
  overdue: number;
  dueToday: number;
}

// `today` is a calendar date (YYYY-MM-DD) so callers decide the time zone.
export function summarize(todos: Todo[], today: string): TodoStats {
  const stats: TodoStats = { total: todos.length, active: 0, completed: 0, overdue: 0, dueToday: 0 };
  for (const todo of todos) {
    if (todo.completed) {
      stats.completed++;
      continue;
    }
    stats.active++;
    if (!todo.due_date) continue;
    if (todo.due_date < today) stats.overdue++;
    else if (todo.due_date === today) stats.dueToday++;
  }
  return stats;
}
