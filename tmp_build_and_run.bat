@echo off
ssh -i "C:\Users\USER\Desktop\Estok_2\Hetzner\llavehezner" -o StrictHostKeyChecking=no root@178.156.224.212 "docker images --filter reference='estok*' --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedAt}}' && docker ps -a --filter name=sq641axhkdx4oz4oss522ht9 --format '{{.ID}} {{.Names}} {{.Status}} {{.Image}}'"
