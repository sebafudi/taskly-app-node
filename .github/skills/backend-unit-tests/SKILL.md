---
name: backend-unit-tests
description: Write Vitest unit tests for the Taskly backend (Express 5, Prisma 7, zod) in the project's existing style. Use when creating or updating tests under backend/tests.
---

# Backend unit tests

Stack: Vitest 4 (node environment), supertest, Express 5, zod 4, Prisma 7 with the pg adapter. Tests never touch a real database or network.

## Layout and imports

- Extend the existing related test file when there is one (append cases; keep the existing ones). Create a new file only for modules without tests.
- Tests live in the **flat** `backend/tests/` directory: `src/features/todos/router.ts` → `tests/router.test.ts`. If a file name is already taken by another module, prefix the folder (`tests/api-health.test.ts`). Use the `suggestedTestPath` from triage.
- Import source with the **`.ts` extension** and relative paths: `import { createTodosRouter } from '../src/features/todos/router.ts'`.
- Import Vitest APIs explicitly: `import { it, expect, vi } from 'vitest'`.
- Shared data is in `tests/fixture.ts`: `record` (a Prisma row) and `todo` (the API shape). Reuse it; extend the fixture file only if several tests need new data.

## Style

- Top-level `it(...)` blocks with behaviour-describing names ("rejects invalid create input without calling the repository"). Use `describe` only to group a large file.
- A small `setup()` function per file that builds the unit under test and its doubles and returns them.
- `it.each` for input tables (invalid payloads, boundary values).
- `afterEach(() => vi.restoreAllMocks())` when using `vi.spyOn`. In Vitest 4 `restoreAllMocks` does not reset automocked module functions (`vi.mock('...')` without a factory), so also call `vi.mocked(fn).mockReset()` (or `vi.resetAllMocks()`) for those.
- Assert both the result **and** the interaction (`toHaveBeenCalledWith`, `not.toHaveBeenCalled`).

## Patterns by layer

**Routers**: mount the router on a fresh app with a fake `TodoStore`, then drive it through supertest:

```ts
function setup() {
  const repository = { list: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}
```

`vi.fn()` resolves to `undefined`, so give each test the result it needs (`repository.get.mockResolvedValue(todo)` or `mockResolvedValue(null)`). Cover the success status and body, 404 for missing records, 422 for invalid ids and bodies (the store must not be called), and that zod defaults and trimming reach the store.

**Repository / Prisma**: build the real client with `createDatabase('postgresql://test:test@localhost:5432/test')` and `vi.spyOn(database.todo, 'findMany')` etc. No connection is opened until a query runs, and the spies replace the queries. Check the exact Prisma arguments and the mapping to the API shape.

**App factory (`factory.ts`)**: pass a fake database object `{ todo: { findFirst: vi.fn(), ... } } as unknown as Database` to `createApp`, then use supertest. Cover 404 fallback, `Invalid JSON.` → 422 (send a malformed body with `.set('Content-Type', 'application/json').send('{')`), 413 for oversized bodies, and 500 for thrown errors (silence `console.error` with `vi.spyOn(console, 'error').mockImplementation(() => {})` and assert it was called).

**Health router**: a fake `database.todo.findFirst`; assert `{ status: 'ok' }` and that a rejected query does not return 200.

**Config (`config.ts`)**: use `vi.stubEnv(name, value)` and `vi.unstubAllEnvs()` in `afterEach`. Stub every variable the function reads, including empty strings for the ones that must be missing, because `config.ts` loads the root `.env` at import time.

**Lifespan (`lifespan.ts`)**: `vi.mock('../src/core/database.ts')` and `vi.mock('../src/factory.ts')` so no Prisma client or HTTP server is real. The `.ts` specifier in the test resolves to the same module the source imports as `.js`. Return a fake app whose `listen(port, host, cb)` returns a fake server (an `EventEmitter` with `address()` and `close(cb)`). Assert the listen port from `API_PORT`, disconnect on failure, and the shutdown path. `start()` registers both SIGTERM and SIGINT with `process.once`: spy on `process.once` and call the captured handlers instead of sending real signals or removing listeners globally. Mock `process.exit` (`vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)`) and drive the 10 s force-exit timer with fake timers.

## Don'ts

- No real PostgreSQL, no `docker`, no `fetch` to real URLs, no reading `.env` for secrets.
- Do not edit `vitest.config.ts`. Its per-file 100% threshold for `validators.ts` and `mappers.ts` must stay green.
- Do not assert on full error stacks or on zod's internal issue wording beyond `status` and the presence of `detail`.
