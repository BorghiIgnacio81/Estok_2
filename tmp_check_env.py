import os
cid = os.environ.get("MERCADOLIBRE_CLIENT_ID", "NO")
csec = os.environ.get("MERCADOLIBRE_CLIENT_SECRET", "NO")
print("CLIENT_ID:", cid)
print("CLIENT_SECRET:", csec[:15] + "..." if csec != "NO" else "NO")
