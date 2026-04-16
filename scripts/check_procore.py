#!/usr/bin/env python3
"""
Procore Integration Setup Checker

Run this before testing the Procore integration to verify all
prerequisites are met.

Usage:
    cd backend
    python ../scripts/check_procore.py
"""

import os
import sys
from pathlib import Path

# Load .env if present
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

REQUIRED = {
    "PROCORE_CLIENT_ID": "OAuth Client ID from developers.procore.com",
    "PROCORE_CLIENT_SECRET": "OAuth Client Secret from developers.procore.com",
    "PROCORE_REDIRECT_URI": "Must match your Procore app's registered redirect URI",
    "SECRET_KEY": "App secret key (used to sign OAuth state parameter)",
    "DATABASE_URL": "PostgreSQL connection URL",
}

OPTIONAL = {
    "SENTRY_DSN": "Error tracking (leave blank for local dev)",
}

RED = "\033[91m"
GRN = "\033[92m"
YEL = "\033[93m"
BLD = "\033[1m"
RST = "\033[0m"

ok = True

print(f"\n{BLD}MIQYAS — Procore Integration Checklist{RST}\n")
print("─" * 50)

# 1. Required env vars
print(f"\n{BLD}1. Environment Variables{RST}")
for var, desc in REQUIRED.items():
    val = os.environ.get(var, "")
    if val:
        masked = val[:4] + "…" + val[-4:] if len(val) > 12 else "***"
        print(f"  {GRN}✓{RST}  {var} = {masked}")
    else:
        print(f"  {RED}✗{RST}  {var} is NOT SET  ← {desc}")
        ok = False

for var, desc in OPTIONAL.items():
    val = os.environ.get(var, "")
    if val:
        print(f"  {GRN}✓{RST}  {var} (set)")
    else:
        print(f"  {YEL}○{RST}  {var} (optional) — {desc}")

# 2. Redirect URI format
print(f"\n{BLD}2. Redirect URI Validation{RST}")
redirect_uri = os.environ.get("PROCORE_REDIRECT_URI", "")
if redirect_uri:
    if "{project_id}" in redirect_uri:
        print(f"  {YEL}!{RST}  PROCORE_REDIRECT_URI contains '{{project_id}}' literal — "
              "Procore expects a static URI. Use a base URL like "
              "http://localhost:3000/procore/callback")
        ok = False
    elif "/integrations" in redirect_uri or "/callback" in redirect_uri:
        print(f"  {GRN}✓{RST}  Redirect URI looks valid: {redirect_uri}")
    else:
        print(f"  {YEL}?{RST}  Redirect URI: {redirect_uri}  (verify it matches Procore app settings)")

# 3. Procore reachability
print(f"\n{BLD}3. Procore API Reachability{RST}")
try:
    import urllib.request
    req = urllib.request.Request(
        "https://api.procore.com/rest/v1.1/me",
        headers={"Authorization": "Bearer invalid"},
    )
    try:
        urllib.request.urlopen(req, timeout=5)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            print(f"  {GRN}✓{RST}  api.procore.com is reachable (got 401 as expected)")
        else:
            print(f"  {YEL}?{RST}  api.procore.com returned HTTP {e.code}")
    except urllib.error.URLError as e:
        print(f"  {RED}✗{RST}  Cannot reach api.procore.com: {e.reason}")
        ok = False
except Exception as e:
    print(f"  {YEL}?{RST}  Could not check reachability: {e}")

# 4. Database connectivity
print(f"\n{BLD}4. Database Connectivity{RST}")
db_url = os.environ.get("DATABASE_URL", "")
if db_url:
    try:
        # Simple sync check using psycopg2
        sync_url = db_url.replace("postgresql+asyncpg://", "postgresql://")
        import psycopg2
        conn = psycopg2.connect(sync_url, connect_timeout=3)
        cur = conn.cursor()
        cur.execute("SELECT 1")
        conn.close()
        print(f"  {GRN}✓{RST}  Database connection successful")

        # Check if procore_configs table exists
        conn = psycopg2.connect(sync_url, connect_timeout=3)
        cur = conn.cursor()
        cur.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'procore_configs'
            )
        """)
        exists = cur.fetchone()[0]
        conn.close()
        if exists:
            print(f"  {GRN}✓{RST}  procore_configs table exists")
        else:
            print(f"  {RED}✗{RST}  procore_configs table missing — run: alembic upgrade head")
            ok = False
    except ImportError:
        print(f"  {YEL}○{RST}  psycopg2 not installed — skipping DB check")
    except Exception as e:
        print(f"  {RED}✗{RST}  Database connection failed: {e}")
        ok = False
else:
    print(f"  {YEL}○{RST}  DATABASE_URL not set — skipping")

# 5. Sandbox vs Production check
print(f"\n{BLD}5. Environment Check{RST}")
client_id = os.environ.get("PROCORE_CLIENT_ID", "")
if "sandbox" in client_id.lower() or "test" in client_id.lower():
    print(f"  {GRN}✓{RST}  Client ID appears to be sandbox credentials")
elif client_id:
    print(f"  {YEL}!{RST}  Could not determine if credentials are sandbox or production")
    print(f"       Visit developers.procore.com → your app → check environment")

# 6. Summary
print(f"\n{'─' * 50}")
if ok:
    print(f"{GRN}{BLD}✓ All checks passed. Ready to test Procore integration.{RST}")
    print(f"\nNext steps:")
    print(f"  1. Start backend: uvicorn app.main:app --reload")
    print(f"  2. Open: http://localhost:5173/projects/<project-id>/integrations")
    print(f"  3. Click 'Connect to Procore' and complete OAuth")
    print(f"  4. Select company + project in the UI")
    print(f"  5. Push an RFI from a project with deviation data")
else:
    print(f"{RED}{BLD}✗ Some checks failed. Fix the issues above before testing.{RST}")
    sys.exit(1)
