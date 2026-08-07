"""Export the live SQLite dev.db to JSON for PostgreSQL migration. Read-only on source.
Usage: python3 export_sqlite.py
"""
import sqlite3
import json
import os

SRC = "/opt/clmx/server/prisma/dev.db"
OUT = "/tmp/clmx_export.json"

con = sqlite3.connect(SRC)
con.row_factory = sqlite3.Row
cur = con.cursor()

tables = [r[0] for r in cur.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%'"
)]

data = {}
for t in tables:
    rows = cur.execute(f'SELECT * FROM "{t}"').fetchall()
    data[t] = [dict(r) for r in rows]

con.close()

with open(OUT, "w") as f:
    json.dump(data, f, default=str)

print("Exported tables:", tables)
print("Row counts:", {t: len(v) for t, v in data.items()})

# Sample a DateTime column to verify storage format (Prisma SQLite -> TEXT ISO)
sample = None
for t in ("Tenant", "User", "Dataset", "Device"):
    if t in data and data[t]:
        row = data[t][0]
        for col in ("createdAt", "updatedAt", "installDate"):
            if col in row:
                sample = f"{t}.{col} = {row[col]!r}"
                break
    if sample:
        break
print("DateTime sample:", sample)
print("Wrote", OUT)
