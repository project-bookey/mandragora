#!/usr/bin/env bash
# Run as root on the Bookey host: bash deploy-bookey.sh <archive> <commit SHA>
set -Eeuo pipefail
ARCHIVE=${1:?Source archive required}
RELEASE_ID=${2:?Commit SHA required}
[[ "$RELEASE_ID" =~ ^[0-9a-f]{40}$ ]] || exit 2
APP_DIR=/opt/mandragora
RELEASE_DIR="$APP_DIR/releases/$RELEASE_ID"
WEB_CONF=/etc/nginx/conf.d/bookey-web.conf
SNIPPET=/etc/nginx/snippets/mandragora.locations.conf
mkdir -p "$APP_DIR/releases" /etc/nginx/snippets
BACKUP_DIR=$(mktemp -d "$APP_DIR/deploy-backup.XXXXXX")
cp -p "$WEB_CONF" "$BACKUP_DIR/bookey-web.conf"
if [[ -f /etc/systemd/system/mandragora.service ]]; then
    cp -p /etc/systemd/system/mandragora.service "$BACKUP_DIR/mandragora.service"
fi
if [[ -f "$SNIPPET" ]]; then cp -p "$SNIPPET" "$BACKUP_DIR/locations.conf"; fi
PREVIOUS=$(readlink "$APP_DIR/current" || true)
WAS_ACTIVE=$(systemctl is-active mandragora || true)
TIMER_WAS_ACTIVE=$(systemctl is-active mandragora-backup.timer || true)
rollback() {
    local status=$?
    trap - ERR
    cp -p "$BACKUP_DIR/bookey-web.conf" "$WEB_CONF"
    if [[ -f "$BACKUP_DIR/locations.conf" ]]; then cp -p "$BACKUP_DIR/locations.conf" "$SNIPPET"; fi
    if [[ -n "$PREVIOUS" ]]; then ln -sfn "$PREVIOUS" "$APP_DIR/current"; fi
    if [[ -f "$BACKUP_DIR/mandragora.service" ]]; then
        cp -p "$BACKUP_DIR/mandragora.service" /etc/systemd/system/mandragora.service
        systemctl daemon-reload
        if [[ "$WAS_ACTIVE" = active ]]; then systemctl restart mandragora; else systemctl stop mandragora || true; fi
    else
        systemctl stop mandragora || true
    fi
    if [[ "$TIMER_WAS_ACTIVE" != active ]]; then systemctl stop mandragora-backup.timer || true; fi
    nginx -t && systemctl reload nginx
    echo "Deployment failed; previous Nginx configuration restored. Backup: $BACKUP_DIR" >&2
    exit "$status"
}
trap rollback ERR
if [[ ! -d "$RELEASE_DIR" ]]; then
    mkdir "$RELEASE_DIR"
    tar -xzf "$ARCHIVE" -C "$RELEASE_DIR" --no-same-owner
fi
test -s "$RELEASE_DIR/dist/index.html"
test -s "$RELEASE_DIR/dist/app.js"
chmod -R a+rX "$RELEASE_DIR"
id mandragora >/dev/null 2>&1 || useradd --system --home-dir /var/lib/mandragora --shell /sbin/nologin mandragora
install -d -m 700 -o mandragora -g mandragora /var/lib/mandragora
if [[ ! -d "$APP_DIR/venv" ]]; then /usr/bin/python3.11 -m venv "$APP_DIR/venv"; fi
"$APP_DIR/venv/bin/pip" install --disable-pip-version-check -r "$RELEASE_DIR/server/requirements.txt"
if [[ -f /var/lib/mandragora/farm.sqlite3 ]]; then
    /usr/bin/python3.11 - "$BACKUP_DIR/farm.sqlite3" <<'PY'
import sqlite3, sys
with sqlite3.connect('/var/lib/mandragora/farm.sqlite3') as source:
    with sqlite3.connect(sys.argv[1]) as backup:
        source.backup(backup)
PY
fi
install -m 644 "$RELEASE_DIR/infra/mandragora.service" /etc/systemd/system/mandragora.service
install -m 644 "$RELEASE_DIR/infra/mandragora-backup.service" /etc/systemd/system/mandragora-backup.service
install -m 644 "$RELEASE_DIR/infra/mandragora-backup.timer" /etc/systemd/system/mandragora-backup.timer
install -m 644 "$RELEASE_DIR/infra/mandragora.locations.conf" "$SNIPPET"
python3 - "$WEB_CONF" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
text = p.read_text()
line = '    include /etc/nginx/snippets/mandragora.locations.conf;'
if line not in text:
    anchor = '    server_name www.bookey.site;'
    if text.count(anchor) < 1:
        raise SystemExit('Expected Bookey www server block missing')
    text = text.replace(anchor, anchor + '\n' + line, 1)
    p.write_text(text)
PY
ln -sfn "$RELEASE_DIR" "$APP_DIR/current"
# Match the existing host's SELinux policy for static web files when enforcing.
if command -v selinuxenabled >/dev/null && selinuxenabled; then
    chcon -R -t httpd_sys_content_t "$APP_DIR"
fi
nginx -t
systemctl daemon-reload
systemctl enable mandragora
systemctl restart mandragora
for attempt in {1..15}; do
    if curl --fail --silent http://127.0.0.1:3211/health >/dev/null; then break; fi
    sleep 1
done
curl --fail --silent --show-error http://127.0.0.1:3211/health
systemctl enable --now mandragora-backup.timer
systemctl start mandragora-backup.service
systemctl reload nginx
curl --fail --silent --show-error --retry 8 --retry-all-errors --retry-delay 1 --resolve www.bookey.site:443:127.0.0.1 \
    https://www.bookey.site/mandragora/ -o /dev/null
curl --fail --silent --show-error --retry 8 --retry-all-errors --retry-delay 1 --resolve www.bookey.site:443:127.0.0.1 \
    https://www.bookey.site/mandragora/api/health
trap - ERR
echo "Deployed $RELEASE_ID at https://www.bookey.site/mandragora/"
echo "Nginx backup: $BACKUP_DIR"
