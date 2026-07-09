@echo off
ssh -i "C:\Users\USER\Desktop\Estok_2\Hetzner\llavehezner" -o StrictHostKeyChecking=no root@178.156.224.212 "curl -s -o /dev/null -w '%%{http_code}' -H 'Host: eeestok.duckdns.org' http://localhost/ 2>&1"
