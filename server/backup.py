"""Create a consistent same-host SQLite snapshot, without importing the API."""
from datetime import datetime, timezone
import os
from pathlib import Path
import sqlite3

os.umask(0o077)
source=Path(os.environ.get('MANDRAGORA_DB','/var/lib/mandragora/farm.sqlite3'))
target=source.parent/'backups'
target.mkdir(mode=0o700,exist_ok=True)
stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
temporary=target/(stamp+'.tmp')
with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as db:
    with sqlite3.connect(temporary) as backup:
        db.backup(backup)
        if backup.execute('PRAGMA integrity_check').fetchone()[0]!='ok':
            raise RuntimeError('Backup integrity check failed')
temporary.rename(target/(stamp+'.sqlite3'))
print('SQLite snapshot saved:',stamp)
