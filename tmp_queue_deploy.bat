@echo off
ssh -i "C:\Users\USER\Desktop\Estok_2\Hetzner\llavehezner" -o StrictHostKeyChecking=no root@178.156.224.212 "docker exec coolify php artisan tinker --execute='$queue = new \App\Models\ApplicationDeploymentQueue(); $queue->application_id = 4; $queue->deployment_uuid = \"manual-\" . uniqid(); $queue->status = \"queued\"; $queue->save(); echo \"OK: \" . $queue->id;'"
