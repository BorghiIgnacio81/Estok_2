<?php
require '/var/www/html/vendor/autoload.php';
$app = require_once '/var/www/html/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

$queue = App\Models\ApplicationDeploymentQueue::find(510);
if ($queue) {
    echo "Status: " . $queue->status . "\n";
    echo "Application ID: " . $queue->application_id . "\n";
    $queue->status = 'processing';
    $queue->save();
    echo "Status changed to processing\n";
} else {
    echo "Queue item 510 not found\n";
}
