# MediHive demo

A 90-second runnable demo of the local + federated profiles. Hit record
on QuickTime / Cleanshot, then run the script. The pacing is calibrated
to read cleanly on screen.

## Prerequisites

```bash
# Postgres
brew install postgresql@16
brew services start postgresql@16
createdb medihive
psql -d postgres -c "CREATE USER medihive WITH PASSWORD 'medihive_dev'; ALTER USER medihive CREATEDB;"

# Repo
git clone https://github.com/tikidragonslayer/MediHive.git
cd MediHive
npm install
npm run build --workspace=@medi-hive/api-server
```

## Run

```bash
chmod +x scripts/demo.sh
./scripts/demo.sh
```

## What it shows

| Step | What | Why it matters |
|---|---|---|
| 1 | `pg_isready` returns | Real Postgres, not a mock. |
| 2 | Migrations apply cleanly | Schema is real and applies idempotently. |
| 3 | 107 tests pass | Audit chain + driver + federation + shield + HTTP. Not 7, not 70. **One hundred seven, all green.** |
| 4 | `MEDIHIVE_PROFILE=local` boots; `/health` reports `vault.kind=local` | The profile env var is a real switch. The health endpoint doesn't lie. |
| 5 | `/health/vault` returns driver metadata | Honest introspection — operators can see what's actually running. |
| 6 | `MEDIHIVE_PROFILE=federated` boots; backend reads as `federated(postgres, solana:devnet)` | Federation is wired and reports both child drivers. |
| 7 | `POST /v2/bridge` with bad signature returns 400 with `verification failed` | Ed25519 signature check is enforced at the API boundary. |

## Recording tips

- **Window size:** 1280×800 or so. Anything wider and the terminal text gets too small.
- **Font size:** ≥18pt. iTerm/Ghostty/Terminal default is too small for video.
- **Run twice.** First run warms caches. Second run for the recording is faster and cleaner.
- **Don't talk over the script.** The colored output narrates itself.
- **Trim the prereq output.** If you've already run `npm install`, the demo doesn't show package downloads.

## Recommended one-liner for QuickTime

1. ⌘⇧5 → "Record selected portion" → drag the terminal window
2. Click "Record"
3. `clear && ./scripts/demo.sh`
4. ⌘⌃⎋ to stop when the script finishes
5. Trim leading silence in QuickTime: Edit → Trim
