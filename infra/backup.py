"""Create a consistent SQLite snapshot; keep fourteen daily backups."""
import os
from datetime import datetime, timezone
from pathlib import Path
import sqlite3

os.umask(0o077)
source = Path("/var/lib/mandragora/messages.sqlite3")
target_dir = source.parent / "message-backups"
target_dir.mkdir(mode=0o700, exist_ok=True)
target = target_dir / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".sqlite3")
temporary = target.with_suffix(".tmp")
with sqlite3.connect(f"file:{source}?mode=ro", uri=True) as src, sqlite3.connect(temporary) as dst:
    src.backup(dst)
    if dst.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise RuntimeError("Backup integrity check failed")
temporary.rename(target)
for old in sorted(target_dir.glob("*.sqlite3"), reverse=True)[14:]:
    old.unlink()
print(f"Snapshot saved: {target}")
