# Build Failures from Cloud Sync File Locking

## Problem

Build tools (Quarto, webpack, compiler toolchains) fail intermittently with "os error 32" (file in use) or similar file locking errors. The cause: a cloud sync service (Dropbox, OneDrive, Google Drive) locks files for sync while the build tool is trying to write to them.

This is especially common with tools that write many files quickly (like a Quarto book build that generates dozens of HTML files), because the sync service detects the new files and starts syncing before the build has finished writing.

## Fix

Stop the sync service before builds, restart after:

```bash
# dropbox_stop.sh
taskkill //IM Dropbox.exe //F 2>/dev/null
echo "Dropbox stopped"

# dropbox_start.sh
cmd //c start "" "C:\Program Files (x86)\Dropbox\Client\Dropbox.exe" /home
echo "Dropbox starting"
```

Usage:

```bash
./dropbox_stop.sh
quarto render          # or whatever build command
./dropbox_start.sh
```

## Why

Cloud sync services use filesystem watchers and file locks to ensure sync integrity. When a build tool writes to a file that the sync service is reading (for upload), the OS reports a sharing violation. The build tool sees an I/O error and fails.

The error is intermittent because it depends on timing — whether the sync service happens to pick up the file during the brief window when the build tool is writing it. This makes it frustrating to debug: the build works most of the time, fails occasionally, and the error message doesn't mention the sync service.

## Alternatives

- **Exclude build output from sync.** Most sync services support folder exclusion. If your build output goes to a dedicated directory (like `_site/` or `dist/`), exclude it. This avoids stopping the sync service entirely.

- **Build in a non-synced directory.** Keep the source in the synced folder, build in a temp directory outside it, then copy the result back.

- **Add retry logic to the build script.** A blunt approach, but works: if the build fails with error 32, wait 2 seconds and retry. Works for scripts where stopping the sync service is impractical.
