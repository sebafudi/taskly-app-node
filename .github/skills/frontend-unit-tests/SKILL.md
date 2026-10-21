---
name: frontend-unit-tests
description: Write Vitest + React Testing Library unit tests for the Taskly frontend (React, TanStack Query, styled-components design system) in the project's existing style. Use when creating or updating tests under frontend/src.
---

# Frontend unit tests

Stack: Vitest 4 with jsdom, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom` (loaded in `src/test/setup.ts`), TanStack Query 5.

## Layout and style

- Tests are **colocated**: `components/TodoList.tsx` → `components/TodoList.test.tsx`; `.ts` modules get `.test.ts`, except when the test needs JSX (for example a TanStack Query `wrapper` for a hook), which makes it `.test.tsx`.
- Prettier style used by the project: no semicolons, single quotes, trailing commas, 2-space indent, about 80 columns.
- Explicit Vitest imports: `import { expect, it, vi } from 'vitest'`.
- Top-level `it(...)` with behaviour-describing names; `describe` only to group a utility's functions. When extending an existing file, keep its structure (some wrap a component in `describe`).
- Shared fixture: `src/test/todoFixture.ts` (`todoFixture`). Spread it to vary fields: `{ ...todoFixture, completed: true }`.

## Isolation rules

- **Always mock the design system** with the shared doubles (this must be literally an async factory, because `vi.mock` is hoisted):
  ```ts
  vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
  ```
  The doubles render plain HTML. `Alert` renders `data-testid="alert"`, `Drawer` renders `role="dialog"` with an accessible name plus a `Close` button disabled by `busy`, and `Input` and `Select` render a `<label>`. Every double is a `vi.fn`, so you can assert its props (`vi.mocked(Alert).mock.calls[0][0]`), and `vi.clearAllMocks()` clears that history too.
- **Unit = one component.** Mock child components that have their own tests with tiny stand-ins (`vi.mock('./TodoItem', () => ({ TodoItem: () => <li>Task</li> }))`).
- **Mock hooks at module level** when testing a component that uses them, and type the return with a cast:
  ```ts
  vi.mock('../hooks/useDeleteTodoMutation', () => ({ useDeleteTodoMutation: vi.fn() }))
  vi.mocked(useDeleteTodoMutation).mockReturnValue({ isPending: false, error: null, mutateAsync } as unknown as ReturnType<typeof useDeleteTodoMutation>)
  ```
- **Mock the API layer, not `fetch`,** when testing hooks: `vi.mock('../api/todos', () => ({ todosApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() } }))`.
- Test `lib/http.ts` itself with `vi.stubGlobal('fetch', vi.fn())` and `vi.unstubAllGlobals()` in `afterEach`. Build responses with `new Response(JSON.stringify(body), { status })`.

## Queries and interactions

- Prefer accessible queries: `getByRole('button', { name: 'Delete task' })`, `getByRole('dialog', { name: ... })`, `getByLabelText`, then `getByText`. Use `getByTestId('alert')` only for the alert double.
- `const user = userEvent.setup()` and `await user.click(...)` / `user.type(...)`; never `fireEvent` for user flows.
- Assert absence with `queryBy*` + `.not.toBeInTheDocument()`.

## Hooks with TanStack Query

Render with a fresh client per test and no retries:

```tsx
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}
const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
await act(() => result.current.mutateAsync(input))
expect(client.getQueryData(todoKeys.list)).toEqual([saved, ...])
```

Seed the cache with `client.setQueryData(todoKeys.list, [...])`, then assert the cache after `onSuccess` (prepend on create, replace on update, filter on delete). Use `waitFor` for query results. The file must be `.test.tsx` when it contains JSX.

## Timers and dates

- `useNotice` clears after 4 s: `vi.useFakeTimers()`, `act(() => vi.advanceTimersByTime(4000))`, and `vi.useRealTimers()` in `afterEach`. Do not combine fake timers with `userEvent` unless you use `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`.
- Date-dependent logic (`isOverdue`): `vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T10:00:00'))`.

## Out of scope

`src/design-system/**`, `main.tsx`, `*.stories.tsx`, `*.styles.ts`, `types.ts`, `*.types.ts`, `index.ts` barrels, `constants` files, `api/queryKeys.ts` and `lib/queryClient.ts` are excluded from coverage by `vite.config.ts`. Do not write unit tests for them.
