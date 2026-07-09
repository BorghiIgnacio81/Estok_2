@echo off
ssh -i "C:\Users\USER\Desktop\Estok_2\Hetzner\llavehezner" -o StrictHostKeyChecking=no root@178.156.224.212 "docker exec coolify sh -c 'ls -la /app/ 2>/dev/null | head -20 && echo --- && ls -la /var/www/ 2>/dev/null | head -20 && echo --- && ls -la /opt/ 2>/dev/null | head -20'"
