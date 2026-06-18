# Hatch-Track Desktop Application - Version History & Release Guidelines

This document serves as the guide for managing, updating, and tracking application versions and changelog history for the Hatch-Track Desktop Application.

---

## 1. Versioning Guidelines (Semantic Versioning)

The application follows the **Semantic Versioning (SemVer)** standard: `MAJOR.MINOR.PATCH`.

```text
  X . Y . Z
  │   │   │
  │   │   └─── PATCH: Bug fixes, small tweaks, security updates (e.g., 1.0.0 -> 1.0.1)
  │   └─────── MINOR: New features, medium updates, backwards-compatible (e.g., 1.0.0 -> 1.1.0)
  └─────────── MAJOR: Breaking changes, major refactors, incompatible API changes (e.g., 1.0.0 -> 2.0.0)
```

### When to Increment:

| Version Increment | Change Type | Example Scenario |
| :--- | :--- | :--- |
| **Patch (Z)** | Small / Patch Updates | Fixing a minor typo in the UI, updating a dependency version, resolving a single bug. |
| **Minor (Y)** | Medium Updates / Features | Adding a new screen, implementing a new reporting layout, upgrading backend/frontend interaction models. |
| **Major (X)** | Feature Releases / Breaking | Migrating the database engine, rewriting the Electron main window architecture, major platform transitions. |

---

## 2. Where to Update the Version in the Codebase

When releasing a new version, you only need to update the version in the package files. The main file dynamically loads the version.

### A. [package.json](file:///d:/Private_Work/React_Train/Commercial/project_space/electron-js-desktop-app/package.json)
Update the `"version"` property near the top of the file:
```json
{
  "name": "hatchery-management-system",
  "version": "1.0.0",  // <--- Update this to the new version
  ...
}
```

### B. [main.js](file:///d:/Private_Work/React_Train/Commercial/project_space/electron-js-desktop-app/main.js#L36-L37)
The window title dynamically extracts the version from `package.json` using Electron's native API:
```javascript
title: `Hatchery Management System Version ${app.getVersion()}`
```
No manual update is needed here!

### C. [package-lock.json](file:///d:/Private_Work/React_Train/Commercial/project_space/electron-js-desktop-app/package-lock.json)
This file tracks npm dependencies and the root project version. It is **highly recommended** to let `npm` handle this automatically rather than modifying it manually.

---

## 3. Best Practice: Automating Version Updates

Instead of manually editing `package.json` and `package-lock.json`, you can use standard `npm version` CLI commands. Running these commands will automatically update the version in both JSON files, commit the changes, and create a Git release tag.

Run one of the following commands in the root of your Electron project:

```bash
# For small bug fixes and patches (e.g., 1.0.0 -> 1.0.1)
npm version patch

# For new features and medium changes (e.g., 1.0.0 -> 1.1.0)
npm version minor

# For major releases (e.g., 1.0.0 -> 2.0.0)
npm version major
```

> [!NOTE]
> Running the automation commands above is all you need to sync versions in the code. Once updated, document the new version release notes in the section below.

---

## 4. Version Change History

| Version | Date | Type | Description |
| :--- | :--- | :--- | :--- |
| **1.0.0** | 2026-06-18 | Initial Release | First stable release of the unified Hatch-Track desktop wrapper. Bundled React frontend static assets and Spring Boot `backend.jar` executable. Added automated compilation pipelines and packaging support for Windows `.exe`. |
