from PIL import Image
import os

# Abrir la imagen original
img = Image.open('archivador.png')
print(f'Original size: {img.size}, mode: {img.mode}')

# Crear icono 192x192
icon192 = img.resize((192, 192), Image.LANCZOS)
icon192.save('frontend/public/icons/icon-192x192.png', 'PNG')
print(f'Created icon-192x192.png: {os.path.getsize("frontend/public/icons/icon-192x192.png")} bytes')

# Crear icono 512x512
icon512 = img.resize((512, 512), Image.LANCZOS)
icon512.save('frontend/public/icons/icon-512x512.png', 'PNG')
print(f'Created icon-512x512.png: {os.path.getsize("frontend/public/icons/icon-512x512.png")} bytes')

# Crear favicon.png (32x32)
favicon = img.resize((32, 32), Image.LANCZOS)
favicon.save('frontend/public/favicon.png', 'PNG')
print(f'Created favicon.png: {os.path.getsize("frontend/public/favicon.png")} bytes')

# Crear apple-touch-icon (180x180)
apple = img.resize((180, 180), Image.LANCZOS)
apple.save('frontend/public/icons/apple-touch-icon.png', 'PNG')
print(f'Created apple-touch-icon.png: {os.path.getsize("frontend/public/icons/apple-touch-icon.png")} bytes')

# Crear favicon.ico (multi-size)
favicon_ico = img.resize((32, 32), Image.LANCZOS)
favicon_ico.save('favicon.ico', format='ICO', sizes=[(16,16), (32,32), (48,48)])
print(f'Created favicon.ico: {os.path.getsize("favicon.ico")} bytes')

print('All icons generated successfully!')
