# GitHub Container Cleanup Action

GitHub Action to automate the cleanup of old, non-production container images from the GitHub Container Registry (GHCR).

## 📖 Description

Maintaining the container registry by removing temporary images (e.g., from feature branches or PR builds). This action identifies and deletes these "noise" versions while strictly protecting your production releases.

It uses a safety-first approach:

- Protects the latest tag automatically.
- Protects any tags/IDs you define via literal strings or Regular Expressions.
- Targets specifically non-SemVer tags (like commit SHAs) or pre-releases.
- Validates age so you don't delete builds currently in testing.

## 🛠 Usage

Basic Example

```YAML

- name: Cleanup Images
  uses: freke/github_docker_package_cleanup@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    package: "my-app"
    days: 14
```

Advanced Example (Regex & Org Support)

```YAML
- name: Cleanup Images
  uses: freke/github_docker_package_cleanup@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    package: "my-app"
    org: "my-organization"
    days: 30
    keep: "^v[0-9]+\\.[0-9]+\\.[0-9]+$, ^prod-, 8675309"
    dry_run: true # Set to false to actually delete
```

## ⚙️ Inputs

| Input   | Description                                                             | Required | Default |
| ------- | ----------------------------------------------------------------------- | -------- | ------- |
| token   | GitHub token (`GITHUB_TOKEN` or PAT) with `write:packages` permissions. | Yes      | N/A     |
| package | The name of the container package.                                      | Yes      | N/A     |
| org     | The GitHub Organization name (omit if user-owned).                      | No       | N/A     |
| days    | Delete versions older than this many days.                              | No       | 7       |
| keep    | Comma-separated list of tags, IDs, or regex to protect.                 | No       | ""      |
| dry_run | If true, logs the targets without deleting them.                        | No       | false   |

## 🔍 Filtering Logic

The action filters the list of all package versions based on these sequential rules:

- Tag Protection: If a version is tagged latest, it is kept.
- Whitelist Protection: If a version's ID or any of its Tags match an entry in the keep list (including Regex matches), it is kept.
- Type Filtering: The action targets versions that are untagged, have non-SemVer tags (e.g., feat-api-fix), or are pre-releases (e.g., 1.0.0-beta). Full SemVer releases (e.g., 1.0.0) are kept.
- Age Threshold: If the version was updated more recently than the days input, it is kept.

## 🛡 Security

This action uses safe-regex to validate your keep patterns before execution. This prevents ReDoS (Regular Expression Denial of Service) attacks by ensuring your patterns don't contain catastrophic backtracking logic.

## 📦 Permissions

For the action to function, your PAT must have the following permissions:

- `write:packages`
