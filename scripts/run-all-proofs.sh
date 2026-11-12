#!/usr/bin/env bash
# Run every proof that guards this product, in one command.
#
# Each proof answers one question about the shipped system and prints its own
# pass count. They are cheap and they fail loudly; the reason to have them in one
# place is that a suite nobody runs decays silently — one of these had been
# pointing at a port that no longer existed for weeks, and passing had become
# indistinguishable from not running.
#
#   ./scripts/run-all-proofs.sh              everything
#   ./scripts/run-all-proofs.sh --no-rust    skip the Rust unit tests
#   ./scripts/run-all-proofs.sh --only slotharc,deletion-log
#
# Exit code is the number of failures, capped at 1 so it reads as a boolean.

set -uo pipefail

WEB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_ROOT="${SERVER_ROOT:-/opt/data/cache/scratch/onsrv}"
SSH_KEY="${SSH_KEY:-/opt/data/home/.ssh/mail_ed25519}"
HOST="${HOST:-root@46.62.155.175}"
JWT_FILE="${JWT_FILE:-/tmp/admin.jwt}"

DO_RUST=1
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-rust) DO_RUST=0 ;;
    --only) ONLY="$2"; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

# Pass counts come out in a few shapes: "15 passed, 0 failed", "25/25 checks passed",
# "test result: ok. 66 passed". Any zero in the failed/denominator slot is a failure.
declare -a NAMES=() RESULTS=() DETAILS=()
FAILURES=0

should_run() {
  [ -z "$ONLY" ] && return 0
  case ",$ONLY," in *",$1,"*) return 0 ;; *) return 1 ;; esac
}

record() {
  local name="$1" ok="$2" detail="$3"
  NAMES+=("$name"); RESULTS+=("$ok"); DETAILS+=("$detail")
  if [ "$ok" != "0" ]; then
    FAILURES=$((FAILURES + 1))
    printf '  FAIL  %-18s %s\n' "$name" "$detail"
  else
    printf '  ok    %-18s %s\n' "$name" "$detail"
  fi
}

# JWT for the signup proof: an administrator session, which that proof cannot mint
# for itself. Missing is a skip, never a pass.
ADMIN_JWT=""
if [ -n "${PROOF_ADMIN_JWT:-}" ]; then
  ADMIN_JWT="$PROOF_ADMIN_JWT"
elif [ -r "$JWT_FILE" ]; then
  ADMIN_JWT="$(tr -d '\n' < "$JWT_FILE")"
else
  ADMIN_JWT="$(ssh -i "$SSH_KEY" -o BatchMode=yes "$HOST" 'cat /root/.admin.jwt 2>/dev/null' || true)"
fi

echo "Sloth Mail — full proof run"
echo "web:    $WEB_ROOT"
echo "server: $SERVER_ROOT"
echo

# The proofs live in the server repo as well as on the box. A proof that exists in two
# places and is edited in one is how one of these sat pointing at a port that had not
# existed for weeks: nothing ran it, so nothing noticed.
PROOFS_DIR="$SERVER_ROOT/proofs"
if [ -d "$PROOFS_DIR" ]; then
  if scp -q -i "$SSH_KEY" "$PROOFS_DIR"/proof-*.py "$HOST:/root/"; then
    echo "proofs synced from $PROOFS_DIR"
  else
    echo "warning: could not sync proofs to $HOST — running whatever is already there"
  fi
  echo
fi

# ── Edge policy: the headers that decide whether the browser can work at all ──
# A CSP without 'wasm-unsafe-eval' blocks Argon2, and sign-in dies in the browser
# with the server seeing nothing. Every proof here talks to the API, so none of them
# noticed for an hour. This one reads the header the browser actually gets.
if should_run headers; then
  start=$(date +%s)
  hdr=$(curl -sSI "https://mail.slothlee.xyz/login?proof=$RANDOM" | tr -d '\r')
  elapsed=$(( $(date +%s) - start ))
  missing=""
  printf '%s' "$hdr" | grep -qi "script-src 'self' 'wasm-unsafe-eval'" || missing="csp-without-wasm-unsafe-eval "
  printf '%s' "$hdr" | grep -qi '^strict-transport-security' || missing="${missing}hsts "
  printf '%s' "$hdr" | grep -qi '^x-content-type-options' || missing="${missing}nosniff "
  printf '%s' "$hdr" | grep -qi '^x-frame-options' || missing="${missing}x-frame-options "
  printf '%s' "$hdr" | grep -qi '^content-security-policy:' || missing="${missing}csp "
  if [ -z "$missing" ]; then
    record headers 0 "policy allows wasm; hsts, nosniff, xfo present (${elapsed}s)"
  else
    record headers 1 "missing: ${missing}"
  fi
fi

# ── Rust: the primitives everything else stands on ────────────────────────────
if [ "$DO_RUST" = 1 ] && should_run rust; then
  if [ -d "$SERVER_ROOT" ]; then
    start=$(date +%s)
    # Keep the raw output: filtering it down to one line is how a command that never
    # ran reads as "no output" instead of "not found". Note the env-assignment prefix —
    # `export A=b cargo test` exports variables called cargo and test instead of
    # running the tests.
    out=$(cd "$SERVER_ROOT" && PATH="$HOME/.cargo/bin:$PATH" \
      CARGO_TARGET_DIR=/opt/data/cache/rust/target \
      cargo test --release 2>&1)
    elapsed=$(( $(date +%s) - start ))
    count=$(printf '%s' "$out" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' | head -1)
    if printf '%s' "$out" | grep -q "^test result: ok"; then
      record rust 0 "${count:-?} tests (${elapsed}s)"
    else
      detail=$(printf '%s' "$out" | grep -vE '^\s*$' | tail -2 | tr '\n' ' ' | cut -c1-160)
      record rust 1 "cargo test failed (${elapsed}s): ${detail:-no output}"
    fi
  else
    record rust 0 "skipped: no server checkout at $SERVER_ROOT"
  fi
fi

# ── Node proofs: run against the live service ─────────────────────────────────
run_node() {
  local name="$1" start elapsed out status count
  start=$(date +%s)
  # The verdict is the exit status, carried back explicitly. Matching "N passed,
  # 0 failed" in the text let a proof that crashed after printing a partial line read
  # as a pass, and the same mistake was already fixed once for the remote proofs.
  out=$(cd "$WEB_ROOT" && node "scripts/proof-${name}.mjs" 2>&1; echo "EXIT:$?")
  status=$(printf '%s' "$out" | sed -n 's/^EXIT://p' | tail -1)
  elapsed=$(( $(date +%s) - start ))
  count=$(printf '%s' "$out" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' | tail -1)
  if [ "${status:-1}" = "0" ]; then
    record "$name" 0 "${count:-?} checks (${elapsed}s)"
  else
    record "$name" 1 "exit ${status:-?}: $(printf '%s' "$out" | grep -v '^EXIT:' | tail -3 | tr '\n' ' ' | cut -c1-200)"
  fi
}

for name in slotharc reseal pq-interop deletion-log phone-render security-key pgp-account pgp-ui; do
  should_run "$name" && run_node "$name"
done

# ── Python proofs on the server: they exercise delivery, not just the API ─────
run_remote() {
  local name="$1" args="${2:-}" start elapsed out status passed
  start=$(date +%s)
  # The verdict comes from the proof's EXIT STATUS, carried back explicitly. Judging
  # it by matching "N/N checks passed" in the output was worse than useless: 29/30
  # matched the pattern and reported ok, so the suite could not fail.
  out=$(ssh -i "$SSH_KEY" -o BatchMode=yes "$HOST" \
    "python3 /root/proof-${name}.py ${args} > /tmp/proof-${name}.log 2>&1; echo EXIT:\$?; tail -4 /tmp/proof-${name}.log")
  status=$(printf '%s' "$out" | sed -n 's/^EXIT://p' | tail -1)
  elapsed=$(( $(date +%s) - start ))
  passed=$(printf '%s' "$out" | grep -oE '([0-9]+/[0-9]+|[0-9]+) (checks )?passed' | head -1)
  if [ "${status:-1}" = "0" ]; then
    record "$name" 0 "${passed:-passed} (${elapsed}s)"
  else
    record "$name" 1 "exit ${status:-?}: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-160)"
  fi
}

for name in ephemeral aliases two-way-aliases push sealed-notes; do
  should_run "$name" && run_remote "$name"
done

# The sealed-attachment proof needs armour that only a client can produce, so the
# fixture is generated here and pushed. It used to be made by hand and left in /tmp,
# which is why a reboot turned a passing proof into a crash.
if should_run sealed-files; then
  if (cd "$WEB_ROOT" && node scripts/make-sealed-files-fixture.mjs /tmp/sealed-files.json >/dev/null 2>&1) \
     && scp -q -i "$SSH_KEY" /tmp/sealed-files.json "$HOST:/tmp/sealed-files.json"; then
    run_remote sealed-files
  else
    record sealed-files 1 "could not produce the armour fixture"
  fi
fi

if should_run scheduled; then
  if [ -n "$ADMIN_JWT" ]; then
    run_remote scheduled "$(printf '%q' "$ADMIN_JWT")"
  else
    record scheduled 0 "skipped: no administrator JWT (set PROOF_ADMIN_JWT)"
  fi
fi

if should_run pending-signup; then
  if [ -n "$ADMIN_JWT" ]; then
    run_remote pending-signup "$(printf '%q' "$ADMIN_JWT")"
  else
    record pending-signup 0 "skipped: no administrator JWT (set PROOF_ADMIN_JWT)"
  fi
fi

echo
echo "────────────────────────────────────────────────────────"
printf '%d proofs, %d failed\n' "${#NAMES[@]}" "$FAILURES"
if [ "$FAILURES" -gt 0 ]; then
  echo
  echo "Failing:"
  for i in "${!NAMES[@]}"; do
    [ "${RESULTS[$i]}" = "0" ] || echo "  - ${NAMES[$i]}: ${DETAILS[$i]}"
  done
fi

[ "$FAILURES" -eq 0 ]
