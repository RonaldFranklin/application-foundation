#!/bin/sh
set -eu
# Hex-only credentials avoid Redis configuration quoting/injection ambiguity.
case "${REDIS_PASSWORD:-}" in
  *[!a-fA-F0-9]*|'') echo 'REDIS_PASSWORD must contain 64 hexadecimal characters' >&2; exit 1 ;;
esac
[ "${#REDIS_PASSWORD}" -eq 64 ] || { echo 'REDIS_PASSWORD must contain 64 hexadecimal characters' >&2; exit 1; }
umask 077
mkdir -p /run/redis
{
  printf '%s\n' 'bind 0.0.0.0' 'protected-mode yes' 'port 6379' 'dir /data' 'appendonly yes' 'appendfsync everysec' 'save ""' 'maxmemory-policy noeviction'
  printf 'requirepass %s\n' "$REDIS_PASSWORD"
} > /run/redis/redis.conf
chown redis:redis /run/redis /run/redis/redis.conf
unset REDIS_PASSWORD
exec /usr/local/bin/docker-entrypoint.sh redis-server /run/redis/redis.conf
