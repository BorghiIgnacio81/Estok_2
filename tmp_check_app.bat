@echo off
ssh -i "C:\Users\USER\Desktop\Estok_2\Hetzner\llavehezner" -o StrictHostKeyChecking=no root@178.156.224.212 "curl -s -o /dev/null -w '%%{http_code}' http://localhost:8000/ 2>&1 || wget -q -O- http://localhost:8000/ 2>&1 | head -5"
