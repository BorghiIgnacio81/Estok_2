@echo off
ssh -i "C:\Users\USER\Desktop\Estok_2\Hetzner\llavehezner" -o StrictHostKeyChecking=no root@178.156.224.212 "docker exec coolify php artisan tinker --execute='$app = \App\Models\Application::find(4); echo \"Relations: \"; print_r(array_keys($app->getRelations())); echo \"\n\"; echo \"app_id: \" . $app->id . \"\n\";'"
