---
name: pr-test-triage
description: Decide which files changed in a pull request need new or updated unit tests, and which should be skipped, with a reason for each. Use at the start of every unit test agent run.
---

# PR test triage

Goal: a short, justified decision per changed file. You will report this table at the end, so record the reasons as you go.

## Steps

1. Call `analyze_pr_changes` with `include_coverage: true`. Every file comes back with:
   - `kind`: source, test, types, story, config, ...
   - `testable`: whether a unit test is expected for this kind of file
   - `action`: the recommendation, one of `create-tests`, `update-tests`, `skip`, `flag-orphaned-tests`
   - `relatedTests`: existing tests that import the file
   - `suggestedTestPath`: where a new test should go
   - `coverage.changedLines`: how many of the lines this PR added are executed by tests today
2. Accept `skip` for non-testable kinds (types, stories, styles, config, docs, generated code). The tool explains why in `reason`. Do not second-guess it.
3. For each testable file, call `get_file_diff` and decide:

| Situation | Decision |
| --- | --- |
| New module, no related tests | **create**: new test file at `suggestedTestPath` |
| Changed behaviour, related tests exist, changed lines uncovered | **update**: add cases to the existing related test file |
| Changed behaviour, the PR already changed the related tests and `changedLines.pct` is 100 | **skip**: "already covered by the PR's own tests" |
| Pure refactor or rename with no behaviour change, and changed lines covered | **skip**: "behaviour unchanged, existing tests cover it" |
| Only comments, logging text, or formatting changed | **skip**: "no behavioural change" |
| Existing tests now contradict the new behaviour (they fail) | **update** the assertions to the new behaviour *only if* the PR description or code makes the intent unambiguous; otherwise report it and leave them |
| `flag-orphaned-tests` (source deleted, tests still import it) | **report** for a human; you may not delete tests |

4. Prioritise by risk: business logic, validation, error handling, and data mapping first; thin glue code last. At most 12 files are actionable per run. If more are left, list them as follow-ups.

## What a "testable change" is

Worth testing: new branches, conditions, validation rules, error paths, state transitions, API request shapes, query cache updates, user-visible rendering that depends on props or state.

Not worth a unit test: wiring that only passes props through, constant re-exports, styling, and code only reachable by starting the real server or browser (`main.ts`, `main.tsx`).

## Output (keep it for the report)

```
| File | Decision | Reason |
| backend/src/features/todos/router.ts | update backend/tests/router.test.ts | new 409 branch for duplicate titles is uncovered |
| frontend/src/features/todos/types.ts | skip | type declarations only |
```
