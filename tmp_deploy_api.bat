@echo off
ssh -i "C:\Users\USER\Desktop\Estok_2\Hetzner\llavehezner" -o StrictHostKeyChecking=no root@178.156.224.212 "docker exec coolify php artisan tinker --execute='$app = \App\Models\Application::where(\"uuid\",\"sq641axhkdx4oz4oss522ht9\")->first(); $app->status = \"running\"; $app->save(); echo \"OK\";'"
