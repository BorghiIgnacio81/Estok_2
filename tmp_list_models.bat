@echo off
ssh -i "C:\Users\USER\Desktop\Estok_2\Hetzner\llavehezner" -o StrictHostKeyChecking=no root@178.156.224.212 "docker exec coolify php artisan tinker --execute='echo implode(\"\n\", \Illuminate\Support\Facades\File::directories(app_path(\"Models\")));'"
