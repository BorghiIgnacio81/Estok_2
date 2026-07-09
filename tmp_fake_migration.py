import psycopg2
import os

# Get DB connection info from environment
conn = psycopg2.connect(
    host=os.environ.get('DB_HOST', 'cagtcifjoy8ydxugg4bkdll1'),
    port=os.environ.get('DB_PORT', '5432'),
    dbname=os.environ.get('DB_NAME', 'estok'),
    user=os.environ.get('DB_USER', 'estok_user'),
    password=os.environ.get('DB_PASSWORD', '')
)

cur = conn.cursor()
cur.execute("INSERT INTO django_migrations (app, name, applied) VALUES ('inventario', '0011_add_alias_por_estok', NOW()) ON CONFLICT DO NOTHING")
conn.commit()
print("Migration 0011 marked as applied successfully")
cur.close()
conn.close()
