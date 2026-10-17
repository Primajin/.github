# Reusable workflows

Shared CI building blocks for the Primajin repositories. They live in `.github/workflows/` of this repository and are
called from other repositories with `uses: Primajin/.github/.github/workflows/<file>@v1`.

| Workflow | Purpose |
| --- | --- |
| [`reusable-test.yml`](../.github/workflows/reusable-test.yml) | Lint and unit tests for an npm project, optional coverage and Codecov upload |
| [`reusable-lint-pr-title.yml`](../.github/workflows/reusable-lint-pr-title.yml) | Sync the PR title bump level with the commits and validate Conventional Commits |
| [`reusable-release-please.yml`](../.github/workflows/reusable-release-please.yml) | release-please plus moving the floating major tag |
| [`lockfile-summary.yml`](../.github/workflows/lockfile-summary.yml) | Comment which packages changed in `package-lock.json` on Renovate PRs |

Not reusable, used by this repository itself: [`release-major-tag.yml`](../.github/workflows/release-major-tag.yml) moves
the `v1`, `v2`, ... tags of this repository (see below).

## Versioning policy

- Callers pin the floating major tag: `@v1`. They receive backwards-compatible fixes and improvements automatically.
- A change that renames or removes an input, output or secret, or that needs more permissions from the caller, is a
  breaking change and ships as a new major (`v2`). The old major keeps working until it is retired.
- Until `v1` exists, `@main` works for trials, but do not leave it in a repository: every merge here would change that
  repository's CI immediately. `lockfile-summary.yml` is the one exception today: webapp-console-log-action calls it
  with `@main`, and it moves to `@v1` once the tag exists.
- Known limitation: the callers pin tags, not commit SHAs, so a moved tag changes their CI without a PR in the caller.
  SHA pinning is not enforced; the tag ruleset below is what protects the tag.

### Cutting a release and moving the major tag

[`release-major-tag.yml`](../.github/workflows/release-major-tag.yml) force-moves `vMAJOR` to the commit of the newest
pushed `vMAJOR.MINOR.PATCH` tag. Before it moves anything it checks that the tag is a strict `vX.Y.Z`, that its commit
is on `main`, and that it is the newest `vX.*` tag (the major tag never moves backwards). Runs are serialized.

1. Merge the change to `main`.
2. Create and push the release tag from `main`:
   ```sh
   git switch main && git pull
   git tag v1.0.0 && git push origin v1.0.0
   ```
   Optionally add release notes: `gh release create v1.0.0 --verify-tag --generate-notes`.
3. Verify that the major tag exists and points to the release commit:
   ```sh
   git ls-remote --tags origin v1 v1.0.0
   ```
4. Fallback: a tag push only triggers the workflow when the workflow file exists on the tagged commit, and tags created
   by an Actions run with `GITHUB_TOKEN` (for example by release-please) never trigger other workflows. Run it by hand
   from `main` instead:
   ```sh
   gh workflow run release-major-tag.yml -f tag=v1.0.0
   ```

### Recommended tag ruleset

Because callers run whatever `@v1` points to, restrict who can create, move or delete `v*` tags. Recommended
repository ruleset (*Settings > Rules > Rulesets*, target: tags, pattern `v*`, enforcement active): restrict creation,
update and deletion, with the repository admin role and the GitHub Actions app as bypass actors, so that only the owner
and `release-major-tag.yml` can move the tags. This ruleset is a recommendation and is not created by this repository.

## Things to know before calling

- **Permissions.** A called workflow can never have more permissions than the calling job grants. Always set
  `permissions:` on the calling job as shown in the examples.
- **Secrets.** Pass secrets explicitly (`secrets: CODECOV_TOKEN: ${{ secrets.CODECOV_TOKEN }}`). `secrets: inherit` only
  works between repositories of the same organization or enterprise, and repositories of a personal account are not
  one, so do not rely on it for cross-repository calls.
- **Access.** This repository is public, so any repository can call these workflows. If it ever becomes private or
  internal, set *Settings > Actions > General > Access* to allow access from the calling repositories (REST:
  `PUT /repos/{owner}/{repo}/actions/permissions/access`).
- **Check names.** In a pull request the checks of a reusable workflow show as `<calling job> / <called job>`, for
  example `test / Lint the code.`. Branch rulesets should require the aggregator job `All checks green` (see below)
  rather than the individual checks.
- **Command inputs are trusted code.** `lint-command`, `test-command` and `coverage-command` of `reusable-test.yml`
  run through `bash -c`. Set them in the workflow file and never build them from pull request or other event data.
- **Release PRs do not run CI.** PRs and releases created by release-please with `GITHUB_TOKEN` do not trigger other
  workflows. That is a GitHub limitation of the default token; use a PAT or GitHub App token in the caller if CI is
  needed on the release PR.
- **Triggers and `if:` conditions stay in the caller.** Reusable workflows define no `on:` triggers besides
  `workflow_call`.

## `reusable-test.yml`

Two jobs: `Lint the code.` and `Run unit tests.` (names kept so that existing check names do not change).

| Input | Type | Default | Description |
| --- | --- | --- | --- |
| `node-version` | string | `'24'` | Node.js version for `actions/setup-node` |
| `lint-command` | string | `npm run lint` | Lint command |
| `test-command` | string | `npm test` | Unit test command, used when `coverage` is false |
| `coverage` | boolean | `false` | Run `coverage-command` instead and upload to Codecov |
| `coverage-command` | string | `npm run coverage` | Coverage command, used when `coverage` is true |
| `test-job-name` | string | `Run unit tests.` | Display name of the unit test job |

| Secret | Required | Description |
| --- | --- | --- |
| `CODECOV_TOKEN` | no | Codecov upload token, only used when `coverage` is true |

Dependencies are installed with `npm ci`, so the repository needs a `package-lock.json`.

```yaml
jobs:
  test:
    permissions:
      contents: read
    uses: Primajin/.github/.github/workflows/reusable-test.yml@v1
    with:
      coverage: true
    secrets:
      CODECOV_TOKEN: ${{ secrets.CODECOV_TOKEN }}
```

## `reusable-lint-pr-title.yml`

Two jobs: `Promote PR title bump level to match highest commit bump level` (skipped for fork and Dependabot PRs, whose tokens are read-only) and
`Validate PR title follows Conventional Commits`. Call it from a `pull_request` workflow on `opened`, `edited`,
`synchronize` and `reopened`.

| Input | Type | Default | Description |
| --- | --- | --- | --- |
| `types` | string | `feat fix docs style refactor perf test build ci chore revert deps` (one per line) | Allowed types |
| `require-scope` | boolean | `false` | Require a scope in the title |

```yaml
jobs:
  lint-pr-title:
    if: github.event_name == 'pull_request' && contains(fromJSON('["opened","edited","synchronize","reopened"]'), github.event.action)
    permissions:
      pull-requests: write
    uses: Primajin/.github/.github/workflows/reusable-lint-pr-title.yml@v1
```

## `reusable-release-please.yml`

Runs release-please and, after a release, moves the floating major tag (`update-major-tag` job). Call it from a `push`
workflow on the default branch.

| Input | Type | Default | Description |
| --- | --- | --- | --- |
| `config-file` | string | `release-please-config.json` | release-please config |
| `manifest-file` | string | `.release-please-manifest.json` | release-please manifest |
| `update-major-tag` | boolean | `true` | Move `vMAJOR` after a release |

| Output | Description |
| --- | --- |
| `release_created` | `'true'` when a release was created |
| `tag_name` | Tag of the release, e.g. `v1.2.3` |
| `major` | Major version, e.g. `1` |

Assumes a single root package and `v`-prefixed tags (`include-v-in-tag: true`, `include-component-in-tag: false`),
because the floating tag is `v<major>`. The major version is validated before the tag is moved. npm publishing is
intentionally not part of this workflow. A repository that publishes to npm adds its own job after
the call, for example `needs: release-please` with `if: needs.release-please.outputs.release_created == 'true'`
(see `workflow-templates/release-please.yml`). Publishing to the GitHub Marketplace stays a manual step.

```yaml
name: Release Please

on:
  push:
    branches:
      - main

jobs:
  release-please:
    permissions:
      contents: write
      pull-requests: write
    uses: Primajin/.github/.github/workflows/reusable-release-please.yml@v1
```

## The `All checks green` aggregator stays in each repository

There is no `reusable-all-green.yml` on purpose. The job needs the repository's own list of jobs (`needs`), and a
reusable workflow cannot see the caller's `needs`. Passing `toJSON(needs)` as an input would work technically, but the
check would then be reported as `<calling job> / <called job>` and could no longer be named exactly `All checks green`,
which the branch rulesets require. Copy this job into the `ci.yml` of each repository and list every other job under
`needs`:

```yaml
  all-green:
    name: All checks green
    if: always()
    needs:
      - test
      - lint-pr-title
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - name: Fail if any required job failed or was cancelled
        shell: bash
        run: |
          results="${{ join(needs.*.result, ' ') }}"
          echo "Job results: $results"
          for r in $results; do
            if [ "$r" = "failure" ] || [ "$r" = "cancelled" ]; then
              echo "::error::A required job did not pass (result=$r)."
              exit 1
            fi
          done
          echo "All jobs succeeded or were skipped."
```

Skipped jobs (for example a `test` job that does not run on a `closed` event) count as passed, so `always()` is needed
on the job and the ruleset should require only `All checks green`.

## Complete `ci.yml` example

```yaml
name: CI

on:
  push:
    branches: [ main ]
  pull_request:
    types:
      - opened
      - reopened
      - synchronize
      - closed
      - edited

permissions: {}

jobs:
  test:
    if: github.event_name == 'push' || (github.base_ref == 'main' && contains(fromJSON('["opened","synchronize","reopened"]'), github.event.action))
    permissions:
      contents: read
    uses: Primajin/.github/.github/workflows/reusable-test.yml@v1
    with:
      coverage: true
    secrets:
      CODECOV_TOKEN: ${{ secrets.CODECOV_TOKEN }}

  lint-pr-title:
    if: github.event_name == 'pull_request' && contains(fromJSON('["opened","edited","synchronize","reopened"]'), github.event.action)
    permissions:
      pull-requests: write
    uses: Primajin/.github/.github/workflows/reusable-lint-pr-title.yml@v1

  all-green:
    name: All checks green
    if: always()
    needs:
      - test
      - lint-pr-title
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - name: Fail if any required job failed or was cancelled
        shell: bash
        run: |
          results="${{ join(needs.*.result, ' ') }}"
          echo "Job results: $results"
          for r in $results; do
            if [ "$r" = "failure" ] || [ "$r" = "cancelled" ]; then
              echo "::error::A required job did not pass (result=$r)."
              exit 1
            fi
          done
          echo "All jobs succeeded or were skipped."
```
