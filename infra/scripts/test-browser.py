#!/usr/bin/env python3
"""Run independent apps through HTTP with ephemeral PostgreSQL and random fixture credentials."""
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
import urllib.request

frontend_port = int(os.environ.get('LOGIN_TEST_FRONTEND_PORT', '3000'))
api_port = int(os.environ.get('LOGIN_TEST_API_PORT', '3001'))
db_port = int(os.environ.get('LOGIN_TEST_DB_PORT', '15440'))
ports = (frontend_port, api_port, db_port)
if len(set(ports)) != 3 or any(not 1024 <= port <= 65535 for port in ports):
    raise ValueError('Test ports must be distinct integers between 1024 and 65535')
for port in ports:
    with socket.socket() as probe:
        try:
            probe.bind(('127.0.0.1', port))
        except OSError as error:
            raise RuntimeError(f'Port {port} must be free before isolated browser tests') from error

root = Path(__file__).resolve().parents[2]
env = os.environ.copy()
env.update(LOGIN_INTEGRATION='1', FIXTURE_MASTER_PASSWORD=secrets.token_hex(24), FIXTURE_USER_PASSWORD=secrets.token_hex(24), NEXT_TELEMETRY_DISABLED='1')
env.update(
    LOGIN_TEST_FRONTEND_PORT=str(frontend_port), LOGIN_TEST_API_PORT=str(api_port), LOGIN_TEST_DB_PORT=str(db_port),
    FIXTURE_FRONTEND_ORIGIN=f'http://localhost:{frontend_port}', FIXTURE_API_ORIGIN=f'http://localhost:{api_port}',
    PUBLIC_API_ORIGIN=f'http://localhost:{api_port}', API_INTERNAL_ORIGIN=f'http://localhost:{api_port}',
)
# On a minimal WSL installation, optionally point at locally extracted Chromium libraries.
backend = subprocess.Popen(['node', '--import', 'tsx', 'test/browser-server.ts'], cwd=root / 'backend', env=env, stdout=subprocess.DEVNULL)
try:
    for attempt in range(120):
        if backend.poll() is not None:
            raise RuntimeError('Fixture backend failed to start')
        try:
            with urllib.request.urlopen(f'http://localhost:{api_port}/v1/health', timeout=1) as response:
                if response.status == 200:
                    break
        except OSError:
            time.sleep(0.5)
    else:
        raise RuntimeError('Fixture startup timed out')
    result = subprocess.run(['npm', 'test'], cwd=root / 'frontend', env=env, check=False)
    sys.exit(result.returncode)
finally:
    backend.terminate()
    try:
        backend.wait(timeout=15)
    except subprocess.TimeoutExpired:
        backend.kill()
        backend.wait()
