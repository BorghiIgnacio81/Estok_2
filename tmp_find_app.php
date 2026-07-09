<?php
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

$app = App\Models\Application::where('name', 'like', '%estok%')->first();
if ($app) {
    echo "ID: " . $app->id . "\n";
    echo "UUID: " . $app->uuid . "\n";
    echo "Name: " . $app->name . "\n";
    echo "Status: " . $app->status . "\n";
} else {
    echo "not found\n";
}
