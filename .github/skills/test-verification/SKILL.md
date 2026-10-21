---
name: test-verification
description: Verify agent-written unit tests before they are pushed - run them, fix failures in the tests, prove they detect the change, measure changed-line coverage, and pass the write-policy check. Use after writing or updating tests.
---

# Test verification

Never claim a result you did not get from a tool in this run. The steps below use the `taskly-test-agent` MCP tools. When they are not available (for example in a local session), use the CLI equivalents from the repository root: `node tools/test-agent/src/cli.mjs analyze --base origin/main --coverage` and `verify --base origin/main --agent-base <start commit>`, or `node_modules/.bin/vitest run` inside a project. Note that Vitest's text coverage table hides files at 100%. CI repeats every one of these checks independently after you finish, and the verification comment on the PR comes from CI, not from you.

## Loop (per test file you touched)

1. **Run it**: `run_tests` with `project` and `files: [<your test file>]`.
2. **Failure?** Read the message and decide which case it is:
   - The test is wrong (bad query, wrong mock shape, missing `await`, wrong import path): fix the **test**.
   - The application behaves differently from what the PR intends: this is a suspected bug. Remove that case from your patch and record it for the report (file, test name, input, expected vs actual). Never edit application code.
   - **Never route around a failure.** If you notice the code misbehaves under some condition (another time of day, a boundary value, an empty list), do not pick fixtures that avoid it. Write the test for that condition. When it fails against the stated intent, it is a suspected bug. "Ambiguous" is only acceptable when the PR description and the code are both silent on the case.
   - Give up on a case after 3 failed fix attempts and record why.
3. **Run the whole project** once with `run_tests` (no `files`) to make sure nothing else broke, for example shared fixtures.
4. **Prove it tests the change**: `check_tests_against_base` with your test files.
   - `detectsChange: true` means the test fails on the base code and passes now. That is the evidence that it covers the PR.
   - If none of the tests you wrote for a behaviour change detect it, they probably assert too little. Strengthen the assertions on the new behaviour.
   - Tests for unchanged behaviour (coverage-only tests) are expected to pass on both. That is fine; say so in the report.
5. **Measure**: `get_coverage` for the changed source files. Aim for every executable changed line covered (`changedLines.uncovered` empty). If some lines stay uncovered on purpose, for example unreachable defensive code, note why.
6. **Types and format**: `check_types_and_format` with your test files. Fix type errors in the tests; for formatting, match the project's Prettier style (frontend: no semicolons, single quotes, trailing commas, about 80 columns).
7. **Validate**: `validate_my_changes`. Every violation must be fixed, including removing assertions or test cases from an existing file (extend or rewrite cases instead). Warnings must be justified in the report or fixed. Files under `ignoredRuntimeChanges` were changed by the workflow runtime, not by you: leave them alone and never stage them (use `git add <your test files>`, never `git add -A`).

## Edge conditions to probe

Pick the ones relevant to the change:
- Dates and times: start, middle and end of the day; month and year boundaries; time zone sensitive formatting.
- Numbers and strings: 0, 1, many, limits from validators, empty and whitespace-only input.
- Collections: empty, one item, duplicates, ordering ties.
- Errors: rejected promises, 4xx/5xx responses, missing records.

## Flakiness checklist

Before finishing, check that your tests:
- do not depend on the current date or time without fake timers or `vi.setSystemTime`
- do not depend on test order or on state left by another test (reset mocks, restore spies, unstub env and globals)
- `await` every user event and async assertion, and use `waitFor` / `findBy*` for async UI
- contain no real timeouts, network, or randomness

CI runs your tests three times and fails the run on any inconsistency.
