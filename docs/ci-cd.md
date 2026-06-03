# CI/CD & Automated Releases

This document explains the complete CI/CD setup implemented in **M4**.

## Overview

M4 introduces a professional, stable, and maintainable CI/CD pipeline for EchoFox. The setup follows best practices for automation, security, and developer experience.

## Workflows

### 1. CI Workflow (`ci.yml`)

**File:** `.github/workflows/ci.yml`

**Purpose:** Continuous Integration — ensures code quality on every push and pull request.

**Triggers:**
- Push to `main` and `develop`
- Pull requests to `main` and `develop`

**Jobs:**
- **Lint**: Runs ESLint and Prettier checks
- **Test**: Runs tests on multiple Node.js versions using a matrix

**Node.js Versions:**
- Node 20
- Node 22

**Future Ready:** Easy to extend to Node 24 or 25 LTS by adding versions to the matrix.

---

### 2. Release Workflow (`release.yml`)

**File:** `.github/workflows/release.yml`

**Purpose:** Automatically creates GitHub Releases when the version in `package.json` is bumped.

**Triggers:**
- Push to `main`
- Manual trigger (`workflow_dispatch`)

**Behavior:**
- Detects version changes in `package.json`
- Creates a new Git tag (`vX.Y.Z`)
- Creates a GitHub Release with auto-generated release notes
- Marks beta/alpha versions as pre-releases

---

### 3. Docker Workflow (`docker.yml`)

**File:** `.github/workflows/docker.yml`

**Purpose:** Builds and publishes multi-arch Docker images.

**Triggers:**
- Weekly schedule (every Monday at 00:00 UTC)
- Manual trigger (`workflow_dispatch`)

**Features:**
- Multi-platform build (`linux/amd64` + `linux/arm64`)
- Pushes to both **GHCR** and **Docker Hub**
- Uses GitHub Actions caching for faster builds
- Tags images with version + `latest`

---

### 4. Security Workflow (`security.yml`)

**File:** `.github/workflows/security.yml`

**Purpose:** Automated security scanning.

**Jobs:**
- **CodeQL Analysis**: Scans JavaScript code for vulnerabilities
- **Dependency Review**: Runs on pull requests to block vulnerable dependencies

**Triggers:**
- Push to `main`
- Pull requests
- Weekly schedule (every Wednesday)

---

### 5. Secret Scanning Workflow (`secret-scanning.yml`)

**File:** `.github/workflows/secret-scanning.yml`

**Purpose:** Detects leaked secrets in the codebase.

**Tool Used:** TruffleHog

**Triggers:**
- Push to `main` and `develop`
- Pull requests
- Manual trigger

---

### 6. Dependabot Configuration

**File:** `.github/dependabot.yml`

**Improvements Made:**
- Weekly updates for npm and GitHub Actions
- Grouped dependency updates (production vs dev)
- Reduced PR noise
- Better commit message prefixes

---

## Design Principles

- **Modular workflows** — Each workflow has a single responsibility
- **Matrix builds** — Easy to add future Node.js versions
- **Security first** — Multiple layers of scanning
- **Performance** — Uses caching wherever possible
- **Future-proof** — Designed to support Node 24/25 LTS easily

## How to Trigger a Release

1. Bump the version in `package.json`
2. Commit and push to `main`
3. The Release workflow will automatically create a GitHub Release

---

*Last updated: May 2026*