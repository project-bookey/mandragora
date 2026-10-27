#!/usr/bin/env bash
set -euo pipefail
umask 077

PACKAGE=${1:?archive required}
SHA=${2:?commit SHA required}
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || exit 2
APP=/opt/mandragora
RELEASE="$APP/releases/$SHA"
NODE="$APP/node/bin/node"
test -x "$NODE"
test -s /etc/mandragora-ai.env
BACKUP=$(mktemp -d "$APP/deploy-backup.XXXXXX")
PREVIOUS=$(readlink -f "$APP/current")
cp /etc/systemd/system/mandragora.service "$BACKUP/mandragora.service"
cp /etc/nginx/snippets/mandragora.locations.conf "$BACKUP/mandragora.locations.conf"
for unit in mandragora-generate.service mandragora-generate.timer; do
  if [ -f "/etc/systemd/system/$unit" ]; then
    cp "/etc/systemd/system/$unit" "$BACKUP/$unit"
  fi
done
GENERATOR_WAS_ACTIVE=$(systemctl is-active mandragora-generate.timer || true)
printf '%s\n' "$PREVIOUS" > "$BACKUP/previous-release"
# Keep the old farm's independent snapshots working after current points to Next.js.
if [ -f "$PREVIOUS/server/backup.py" ]; then
  systemctl start mandragora-backup.service
  install -d -m 755 /etc/systemd/system/mandragora-backup.service.d
  printf '[Service]\nExecStart=\nExecStart=/usr/bin/python3.11 %s/server/backup.py\n' "$PREVIOUS" > /etc/systemd/system/mandragora-backup.service.d/preserved-farm.conf
fi

rollback() {
  trap - ERR
  systemctl stop mandragora-generate.timer mandragora-generate.service || true
  for unit in mandragora-generate.service mandragora-generate.timer; do
    if [ -f "$BACKUP/$unit" ]; then
      cp "$BACKUP/$unit" "/etc/systemd/system/$unit"
    else
      systemctl disable "$unit" || true
      rm -f "/etc/systemd/system/$unit"
    fi
  done
  ln -sfn "$PREVIOUS" "$APP/current"
  cp "$BACKUP/mandragora.service" /etc/systemd/system/mandragora.service
  cp "$BACKUP/mandragora.locations.conf" /etc/nginx/snippets/mandragora.locations.conf
  systemctl daemon-reload
  systemctl restart mandragora
  if [ "$GENERATOR_WAS_ACTIVE" = active ]; then
    systemctl start mandragora-generate.timer
  fi
  nginx -t && systemctl reload nginx
  echo "Deployment failed; restored $PREVIOUS" >&2
}
trap rollback ERR
systemctl stop mandragora-generate.timer mandragora-generate.service 2>/dev/null || true

if [ -f /var/lib/mandragora/messages.sqlite3 ]; then
  systemctl start mandragora-messages-backup.service
fi

mkdir -p "$RELEASE"
tar -xzf "$PACKAGE" -C "$RELEASE"
test -f "$RELEASE/server.js"
chmod -R a+rX "$RELEASE"
install -m 644 "$RELEASE/infra/mandragora.service" /etc/systemd/system/mandragora.service
install -m 644 "$RELEASE/infra/mandragora.locations.conf" /etc/nginx/snippets/mandragora.locations.conf
nginx -t
ln -sfn "$RELEASE" "$APP/current"
systemctl daemon-reload
systemctl restart mandragora
curl --fail --silent --show-error --retry 20 --retry-connrefused --retry-delay 2 http://127.0.0.1:3211/mandragora/api/health/
systemctl reload nginx
curl --fail --silent --show-error --retry 10 --retry-all-errors --retry-delay 1 --resolve www.bookey.site:443:127.0.0.1 https://www.bookey.site/mandragora/api/health/
install -m 644 "$RELEASE/infra/mandragora-messages-backup.service" /etc/systemd/system/mandragora-messages-backup.service
install -m 644 "$RELEASE/infra/mandragora-messages-backup.timer" /etc/systemd/system/mandragora-messages-backup.timer
systemctl daemon-reload
systemctl enable --now mandragora-messages-backup.timer
systemctl start mandragora-messages-backup.service
install -m 644 "$RELEASE/infra/mandragora-generate.service" /etc/systemd/system/mandragora-generate.service
install -m 644 "$RELEASE/infra/mandragora-generate.timer" /etc/systemd/system/mandragora-generate.timer
systemctl daemon-reload
systemctl enable --now mandragora-generate.timer
# An upstream AI quota/outage must not roll back a healthy application.
# The timer retries generation with the generator's persisted cooldown.
if ! systemctl start mandragora-generate.service; then
  echo "AI replenishment is pending; mandragora-generate.timer will retry." >&2
fi
trap - ERR
echo "Deployed $SHA; rollback backup: $BACKUP"
