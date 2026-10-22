#!/usr/bin/env bash
# Verification gate for the unit test agent, run in the threat-detection job before any safe output
# is applied. It rebuilds the agent's result from scratch (PR head + the agent's bundle or patch),
# then runs the trusted verifier from the base branch inside a container with no network.
# A non-zero exit fails the detection job, and gh-aw then skips the push and the comment.
#
# Required environment:
#   BASE_SHA      pull request base revision
#   HEAD_SHA      pull request head revision the agent started from
#   GATE_DIR      fresh checkout of HEAD_SHA (full history)
#   TRUSTED_DIR   tools/test-agent extracted from BASE_SHA, with node_modules installed
#   OUT_DIR       where verification.json and verification.md are written
#   NODE_IMAGE    pinned Node image used for the sandboxed run
set -euo pipefail

: "${BASE_SHA:?}" "${HEAD_SHA:?}" "${GATE_DIR:?}" "${TRUSTED_DIR:?}" "${OUT_DIR:?}" "${NODE_IMAGE:?}"
mkdir -p "$OUT_DIR"
cd "$GATE_DIR"
git config user.name "unit-test-agent gate"
git config user.email "gate@localhost"

# 1. Re-create the agent's commits. gh-aw ships them as a git bundle, or as a patch for older transports.
bundle=$(find /tmp/gh-aw -maxdepth 3 -name '*.bundle' -print -quit 2>/dev/null || true)
patch=$(find /tmp/gh-aw -maxdepth 3 -name 'aw-*.patch' -print -quit 2>/dev/null || true)
if [[ -n "$bundle" ]]; then
  git bundle verify "$bundle" >/dev/null
  git fetch --quiet "$bundle" '+refs/*:refs/agent/*'
  agent_head=$(git for-each-ref --sort=-committerdate --format='%(objectname)' refs/agent | head -n1)
  git merge-base --is-ancestor "$HEAD_SHA" "$agent_head" || { echo "::error::Agent bundle does not build on the PR head"; exit 1; }
  git checkout --quiet --detach "$agent_head"
elif [[ -n "$patch" ]]; then
  git am --quiet --3way "$patch"
else
  echo "::error::No agent bundle or patch found under /tmp/gh-aw"
  exit 1
fi
echo "Verifying agent changes: $(git rev-parse --short HEAD) on top of $(git rev-parse --short "$HEAD_SHA")"

# 2. Refuse agent changes outside the test paths before anything from them runs here: npm ci executes
#    package.json lifecycle scripts on this runner, outside the network-less sandbox.
node --input-type=module -e '
  const { isWritable } = await import(process.argv[1]);
  const outside = process.argv[2].split("\n").filter(Boolean).filter((path) => !isWritable(path));
  if (outside.length) {
    console.error(`::error::Agent changed files outside the test paths: ${outside.join(", ")}`);
    process.exit(1);
  }
' "$TRUSTED_DIR/src/lib/policy.mjs" "$(git diff --name-only --no-renames "$HEAD_SHA" HEAD)"

# 3. Install the application's dependencies from the PR's lockfiles, now known to be untouched.
npm ci --prefix backend --no-audit --no-fund --loglevel=error
npm ci --prefix frontend --no-audit --no-fund --loglevel=error

# 4. Run the trusted verifier with the agent's tests inside a network-less container.
status=0
docker run --rm --network=none \
  -v "$GATE_DIR:/workspace" -v "$TRUSTED_DIR:/opt/test-agent:ro" -v "$OUT_DIR:/out" \
  -w /workspace \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0='*' \
  "$NODE_IMAGE" \
  node /opt/test-agent/src/cli.mjs verify --base "$BASE_SHA" --agent-base "$HEAD_SHA" \
    --out /out/verification.json --markdown /out/verification.md || status=$?
sudo chown -R "$(id -u):$(id -g)" "$GATE_DIR" "$OUT_DIR"

cat "$OUT_DIR/verification.md" >> "${GITHUB_STEP_SUMMARY:-/dev/null}" || true
if [[ $status -ne 0 ]]; then
  echo "::error::Verification failed; the agent's changes will not be pushed."
fi
exit "$status"
