import type { Todo } from './types.js';

export interface TodoStats {
  total: number;
  active: number;
  completed: number;
  overdue: number;
  dueToday: number;
  dueSoon: number;
}

const DUE_SOON_DAYS = 7;

// `today` is a calendar date (YYYY-MM-DD) so callers decide the time zone.
// dueSoon counts active tasks due in the next week, after today.
export function summarize(todos: Todo[], today: string): TodoStats {
  const stats: TodoStats = { total: todos.length, active: 0, completed: 0, overdue: 0, dueToday: 0, dueSoon: 0 };
  const horizon = addDays(today, DUE_SOON_DAYS);
  for (const todo of todos) {
    if (todo.completed) {
      stats.completed++;
      continue;
    }
    stats.active++;
    if (!todo.due_date) continue;
    if (todo.due_date < today) stats.overdue++;
    else if (todo.due_date === today) stats.dueToday++;
    else if (todo.due_date <= horizon) stats.dueSoon++;
  }
  return stats;
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
