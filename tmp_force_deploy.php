<?php
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

$queue = App\Models\ApplicationDeploymentQueue::find(510);
if ($queue) {
    echo "Status: " . $queue->status . "\n";
    echo "Application ID: " . $queue->application_id . "\n";
    echo "Force rebuild: " . ($queue->force_rebuild ? 'true' : 'false') . "\n";
    
    // Dispatch the job
    $job = new App\Jobs\ApplicationDeploymentJob($queue, $queue->deployment_uuid);
    dispatch($job);
    echo "Job dispatched!\n";
} else {
    echo "Queue item 510 not found\n";
}
