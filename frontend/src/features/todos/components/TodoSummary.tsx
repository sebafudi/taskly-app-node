import { Text } from '../../../design-system'
import type { Todo } from '../types'
import { summarizeTodos } from '../utils/todos'

export function TodoSummary({ todos }: { todos: Todo[] }) {
  const { active, completed, overdue } = summarizeTodos(todos)
  const parts = [
    `${active} to do`,
    `${completed} completed`,
    ...(overdue ? [`${overdue} overdue`] : []),
  ]
  return (
    <Text role="status" aria-label="Task summary" muted>
      {parts.join(' · ')}
    </Text>
  )
}
