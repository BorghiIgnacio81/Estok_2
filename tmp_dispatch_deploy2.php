<?php
require '/var/www/html/vendor/autoload.php';
$app = require_once '/var/www/html/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

$queue = App\Models\ApplicationDeploymentQueue::find(510);
if ($queue) {
    echo "Status: " . $queue->status . "\n";
    echo "Deployment UUID: " . $queue->deployment_uuid . "\n";
    echo "Queue ID: " . $queue->id . "\n";
    
    // Dispatch the job to Redis queue - constructor expects int (queue id) and string (deployment_uuid)
    $job = new App\Jobs\ApplicationDeploymentJob($queue->id, $queue->deployment_uuid);
    dispatch($job);
    echo "Job dispatched to queue!\n";
} else {
    echo "Queue item 510 not found\n";
}
