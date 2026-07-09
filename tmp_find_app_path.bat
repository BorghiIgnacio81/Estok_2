@echo off
ssh -i "C:\Users\USER\Desktop\Estok_2\Hetzner\llavehezner" -o StrictHostKeyChecking=no root@178.156.224.212 "docker exec coolify sh -c 'find /app -name \"Application.php\" -type f 2>/dev/null | head -5'"
