---
name: pr-test-report
description: Write the unit test agent's pull request comment - decisions per file, tests added or updated, verification results, suspected bugs, and follow-ups. Use as the final step of a unit test agent run.
---

# PR test report

Post exactly one comment with the `add_comment` safe output. A separate CI job posts the independently measured numbers, so your comment explains **what you did and why**. Copy numbers only from tool results of this run.

## Template

```markdown
## 🧪 Unit test agent

**Summary:** <one sentence: e.g. "Added 6 tests across 2 files; all pass and 5 of them fail on the base branch, so they cover the new behaviour.">

### Decisions
| File | Decision | Reason |
| --- | --- | --- |
| `backend/src/...` | Updated `backend/tests/...` | ... |
| `frontend/src/...types.ts` | Skipped | Type declarations only |

### Tests
- `path/to/file.test.ts`: <new|updated>, N cases: <short list of behaviours covered>

### Verification (this run)
| Check | Result |
| --- | --- |
| Tests touched by the agent | ✅ N/N passing |
| Full suites | backend ✅ X/X · frontend ✅ Y/Y |
| Detect the change (fail on base) | N of M |
| Changed lines covered | `file.ts` 100% · `other.tsx` 92% (line 41: defensive fallback) |
| Policy check | ✅ no violations |

### Suspected bugs
<only if any: file, test, expected vs actual. "None found." otherwise>

### Follow-ups
<files skipped for budget, orphaned tests, warnings worth a human look. Omit if empty>

<details><summary>Skills used</summary>
pr-test-triage, backend-unit-tests, ...
</details>
```

## Rules

- When nothing needed tests, post a short comment with the decisions table and the reason. Do not pad it.
- Do not paste code, secrets, environment values, or long logs. Link test files by path.
- Write plainly. No marketing language and no emoji other than the status marks in the template.
- If you pushed nothing because verification failed, say so clearly and list what failed.
