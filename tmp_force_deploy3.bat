@echo off
ssh -i "C:\Users\USER\Desktop\Estok_2\Hetzner\llavehezner" -o StrictHostKeyChecking=no root@178.156.224.212 "docker exec coolify php artisan tinker --execute='$app = \App\Models\Application::find(4); $app->git_commit_sha = \"c827b48\"; $app->status = \"exited\"; $app->save(); echo \"OK: \" . $app->git_commit_sha . \" / \" . $app->status;'"
