# packages/coding-agent

Applies LLM-generated fixes to the filesystem and manages git operations.

## Files

| File | Responsibility |
|------|---------------|
| `apply-fix.ts` | Parses SEARCH/REPLACE blocks from LLM output, applies them to files |
| `self-heal-loop.ts` | Retry loop: generate → apply → test → retry on failure |
| `run-tests.ts` | Runs the configured test command, returns pass/fail + output |
| `git/create-branch.ts` | `createBranch`, `branchExists`, `assertCleanWorkingDirectory` |
| `git/checkout.ts` | `checkoutBranch`, `getCurrentBranch` |
| `git/commit.ts` | `commitChanges`, `hasUncommittedChanges` |
| `git/push-and-pr.ts` | `pushBranch`, `openPullRequest`, `getDefaultBranch` |

## SEARCH/REPLACE format

The LLM is asked to produce edits in this format:

```
```file:path/to/file.ts
<<<<<<< SEARCH
<exact existing code>
=======
<replacement code>
>>>>>>> REPLACE
```
```

`apply-fix.ts` parses these blocks and applies them surgically. If the SEARCH text isn't found verbatim (whitespace drift is common), the file is skipped and the failure is reported back to the self-heal loop for a retry.

## Self-heal loop

`runSelfHealLoop` in `self-heal-loop.ts`:
1. Calls the provider for a fix
2. Applies SEARCH/REPLACE blocks
3. Runs tests
4. If tests fail, rebuilds a retry prompt with the error output
5. Repeats up to `maxAttempts` (default 4)

The retry prompt uses a sliding window — only the most recent failure is included, not the full history, to keep prompt size bounded.