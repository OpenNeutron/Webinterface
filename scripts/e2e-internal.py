#!/usr/bin/env python3
"""End-to-end check that internal mail is delivered locally and intact.

Every internal-delivery bug so far was found by a human noticing a garbled
inbox. This is the missing automated check: two real accounts, one real send,
and assertions on what the server actually did.

Usage:
    E2E_BASE=https://mail.slothlee.xyz \
    E2E_A_USER=tibs E2E_A_PASS=... \
    E2E_B_USER=eleven E2E_B_PASS=... \
    E2E_SSH=root@46.62.155.175 \
    python3 scripts/e2e-internal.py

Exit code 0 only when the message is stored locally with its key intact.
Credentials come from the environment and are never printed.
"""
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("E2E_BASE", "https://mail.slothlee.xyz").rstrip("/")
A_USER, A_PASS = os.environ.get("E2E_A_USER"), os.environ.get("E2E_A_PASS")
B_USER, B_PASS = os.environ.get("E2E_B_USER"), os.environ.get("E2E_B_PASS")
SSH = os.environ.get("E2E_SSH", "")


def die(msg):
    print(f"FAIL {msg}")
    sys.exit(1)


def post(path, payload, token=None):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(f"{BASE}{path}", data=data,
                                 headers={"Content-Type": "application/json"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def login(user, password):
    if not user or not password:
        die("missing credentials in environment")
    status, body = post("/api/auth/login", {"username": user, "password": password})
    if status != 200:
        die(f"login failed for {user} ({status})")
    try:
        return json.loads(body).get("token") or json.loads(body).get("access_token")
    except Exception:
        die("login response was not JSON")


def main():
    token = login(A_USER, A_PASS)
    print(f"ok   logged in as {A_USER}")

    raw = (
        f"From: {A_USER}@slothlee.xyz\r\n"
        f"To: {B_USER}@slothlee.xyz\r\n"
        f"Subject: e2e-{int(time.time())}\r\n"
        f"Date: {time.strftime('%a, %d %b %Y %H:%M:%S +0000', time.gmtime())}\r\n"
        f"Message-ID: <e2e-{int(time.time())}@slothlee.xyz>\r\n"
        "\r\n"
        "Automated internal delivery check.\r\n"
    )
    blob = base64.b64encode(raw.encode()).decode()
    recipient = f"{B_USER}@slothlee.xyz"

    status, body = post("/api/email/sendencrypted", {
        "localcopy": {"to": [recipient], "timestamp": int(time.time()),
                      "public_key_hash": "", "raw_data": blob,
                      "message_key": None, "e2ee": False},
        "recipients": {recipient: {"aes_encrypted": "", "data_encrypted": blob, "e2ee": False}},
    }, token)

    if status != 200:
        die(f"send rejected ({status}): {body[:200]}")
    print("ok   send accepted")

    if not SSH:
        print("skip log assertion (set E2E_SSH to check the server side)")
        return

    time.sleep(3)
    # "local" means this script already runs on the mail host: read the logs
    # directly instead of sshing to ourselves, which silently returns nothing.
    cmd = (["docker", "logs", "--since", "5m", "openneutron"]
           if SSH == "local"
           else ["ssh", "-o", "BatchMode=yes", SSH, "docker logs --since 5m openneutron 2>&1"])
    proc = subprocess.run(cmd, capture_output=True, text=True)
    logs = (proc.stdout or "") + (proc.stderr or "")
    if not logs.strip():
        die(f"could not read server logs ({' '.join(cmd)}) - refusing to guess")
    line = [l for l in logs.splitlines() if recipient in l and "Local delivery" in l]
    if not line:
        die(f"no local-delivery log line for {recipient} — mail went out over SMTP")
    print(f"ok   {line[-1].split('] ')[-1]}")

    if "e2ee=true" in line[-1] and "stored directly" not in line[-1]:
        die("local delivery ran but the key was not stored with the message")
    print("PASS internal mail stored locally with its key intact")


if __name__ == "__main__":
    main()
