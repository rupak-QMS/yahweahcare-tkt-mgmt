#!/usr/bin/env bash
# ============================================================
# Local Postgres → Neon migration
# ============================================================
#
# Dumps the yc_tkt_mgmt schema from your local Postgres and
# restores it to a Neon project, then verifies row counts match.
#
# Usage:
#   chmod +x migrate-to-neon.sh
#   ./migrate-to-neon.sh
# ============================================================

set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Local Postgres → Neon migration tool      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo

# ── 1. Prerequisites ───────────────────────────────────────
if ! command -v pg_dump &>/dev/null || ! command -v psql &>/dev/null; then
  echo -e "${RED}✗ pg_dump / psql not found. Install:${NC}"
  echo "  brew install postgresql@16"
  exit 1
fi

# ── 2. Collect connection details ──────────────────────────
echo -e "${YELLOW}Source database (local Postgres):${NC}"
read -p "  Local DB name [yahweahcare]: " LOCAL_DB
LOCAL_DB=${LOCAL_DB:-yahweahcare}
read -p "  Local user [$USER]: " LOCAL_USER
LOCAL_USER=${LOCAL_USER:-$USER}
read -p "  Local host [localhost]: " LOCAL_HOST
LOCAL_HOST=${LOCAL_HOST:-localhost}
read -p "  Local port [5432]: " LOCAL_PORT
LOCAL_PORT=${LOCAL_PORT:-5432}

LOCAL_URL="postgresql://$LOCAL_USER@$LOCAL_HOST:$LOCAL_PORT/$LOCAL_DB"
echo "  → Source: $LOCAL_URL"
echo

echo -e "${YELLOW}Target database (Neon):${NC}"
echo "  Get your connection string from https://console.neon.tech → Dashboard → Connection Details"
read -p "  Paste Neon connection string: " NEON_URL

if [[ ! "$NEON_URL" =~ neon\.tech ]]; then
  echo -e "${RED}✗ That doesn't look like a Neon URL. Should contain 'neon.tech'.${NC}"
  exit 1
fi
echo

# ── 3. Test connections ────────────────────────────────────
echo -e "${GREEN}→ Testing source connection...${NC}"
if ! psql "$LOCAL_URL" -c '\l' >/dev/null 2>&1; then
  echo -e "${RED}✗ Cannot connect to local Postgres.${NC}"
  echo "  Is PostgreSQL running? Try: brew services start postgresql@16"
  exit 1
fi
LOCAL_VERSION=$(psql "$LOCAL_URL" -tAc 'SHOW server_version_num;')
echo -e "  ✓ Connected (Postgres $LOCAL_VERSION)"

echo -e "${GREEN}→ Testing target connection...${NC}"
if ! psql "$NEON_URL" -c '\l' >/dev/null 2>&1; then
  echo -e "${RED}✗ Cannot connect to Neon. Check the connection string.${NC}"
  exit 1
fi
NEON_VERSION=$(psql "$NEON_URL" -tAc 'SHOW server_version_num;')
echo -e "  ✓ Connected (Postgres $NEON_VERSION)"
echo

# ── 4. Show current data summary ───────────────────────────
echo -e "${GREEN}→ Summary of data to migrate:${NC}"
psql "$LOCAL_URL" -c "
  SELECT table_name,
         (xpath('/row/c/text()',
                query_to_xml(format('SELECT COUNT(*) AS c FROM yc_tkt_mgmt.%I', table_name),
                             FALSE, TRUE, '')))[1]::text::int AS row_count
    FROM information_schema.tables
   WHERE table_schema = 'yc_tkt_mgmt' AND table_type = 'BASE TABLE'
   ORDER BY table_name;
"
echo

# ── 5. Confirm ────────────────────────────────────────────
echo -e "${YELLOW}⚠  This will REPLACE any existing 'yc_tkt_mgmt' schema in Neon.${NC}"
read -p "  Proceed? [y/N] " yn
if [[ ! "$yn" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# ── 6. Dump the local schema ──────────────────────────────
DUMP_FILE="/tmp/yahweahcare-$(date +%Y%m%d-%H%M%S).sql"
echo
echo -e "${GREEN}→ Dumping local data to $DUMP_FILE...${NC}"
pg_dump "$LOCAL_URL" \
  --schema=yc_tkt_mgmt \
  --no-owner \
  --no-privileges \
  --no-tablespaces \
  --no-comments \
  --clean --if-exists \
  --format=plain \
  --quote-all-identifiers \
  > "$DUMP_FILE"

SIZE=$(du -h "$DUMP_FILE" | cut -f1)
LINES=$(wc -l <"$DUMP_FILE")
echo -e "  ✓ Dumped: $SIZE / $LINES lines"

# ── 7. Restore to Neon ────────────────────────────────────
echo
echo -e "${GREEN}→ Restoring to Neon...${NC}"
echo "  (This usually takes 10-60 seconds for typical datasets)"

# Neon doesn't allow CREATE EXTENSION outside specific allow-listed ones,
# and it doesn't have superuser. Strip anything that would fail.
sed -i.bak \
  -e '/CREATE EXTENSION/d' \
  -e '/SELECT pg_catalog.set_config/d' \
  -e '/ALTER .* OWNER TO/d' \
  -e 's/ OWNER TO [a-zA-Z0-9_]*//g' \
  "$DUMP_FILE"

if psql "$NEON_URL" -v ON_ERROR_STOP=1 -f "$DUMP_FILE" > /tmp/neon-restore.log 2>&1; then
  echo -e "  ${GREEN}✓ Restore complete${NC}"
else
  echo -e "  ${RED}✗ Restore had errors${NC}"
  echo "  Last 20 lines of /tmp/neon-restore.log:"
  tail -20 /tmp/neon-restore.log
  echo
  read -p "  Continue with verification anyway? [y/N] " yn
  [[ ! "$yn" =~ ^[Yy]$ ]] && exit 1
fi

# ── 8. Verify row counts match ────────────────────────────
echo
echo -e "${GREEN}→ Verifying row counts...${NC}"

count_in() {
  psql "$1" -tAc "
    SELECT json_agg(t)::text FROM (
      SELECT table_name,
             (xpath('/row/c/text()',
                    query_to_xml(format('SELECT COUNT(*) AS c FROM yc_tkt_mgmt.%I', table_name),
                                 FALSE, TRUE, '')))[1]::text::int AS n
        FROM information_schema.tables
       WHERE table_schema = 'yc_tkt_mgmt' AND table_type = 'BASE TABLE'
       ORDER BY table_name
    ) t
  "
}

LOCAL_COUNTS=$(count_in "$LOCAL_URL")
NEON_COUNTS=$(count_in "$NEON_URL")

printf "  %-30s | %10s | %10s | %s\n" "Table" "Local" "Neon" "Match?"
echo "  -------------------------------+------------+------------+--------"

python3 - <<EOF
import json, sys
local = {r['table_name']: r['n'] for r in json.loads('''$LOCAL_COUNTS''') or []}
neon  = {r['table_name']: r['n'] for r in json.loads('''$NEON_COUNTS''')  or []}
all_tables = sorted(set(local.keys()) | set(neon.keys()))
ok = True
for t in all_tables:
    l, n = local.get(t, 0), neon.get(t, 0)
    match = '✓' if l == n else '✗ MISMATCH'
    if l != n: ok = False
    print(f"  {t:<30} | {l:>10} | {n:>10} | {match}")
sys.exit(0 if ok else 1)
EOF

VERIFY_RESULT=$?
echo

if [ $VERIFY_RESULT -eq 0 ]; then
  echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║  ✅ Migration successful — all rows match  ║${NC}"
  echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
else
  echo -e "${YELLOW}⚠  Row counts differ on at least one table. Review above.${NC}"
fi

echo
echo "Next steps:"
echo "  1. Update YCTMBackend/.env:"
echo "       DATABASE_URL=$NEON_URL"
echo "  2. If running on Vercel/cloud, update DATABASE_URL there too"
echo "  3. Restart backend: npm run dev"
echo "  4. Verify login still works"
echo
echo "Dump kept at: $DUMP_FILE (delete when no longer needed)"
