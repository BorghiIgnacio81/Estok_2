import os
print("CLIENT_ID:", os.environ.get("MERCADOLIBRE_CLIENT_ID", "VACIO")[:15])
print("CLIENT_SECRET:", os.environ.get("MERCADOLIBRE_CLIENT_SECRET", "VACIO")[:10])
