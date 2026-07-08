import os
# version.py esta en inventario/api/viewsets/version.py
p = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath("/app/inventario/api/viewsets/version.py"))))
print("3 up:", p)
print("4 up:", os.path.dirname(p))
print("exists /app/version.json:", os.path.exists("/app/version.json"))
