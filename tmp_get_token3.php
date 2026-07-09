$app = \Coolify\Models\Application::where("uuid","sq641axhkdx4oz4oss522ht9")->first();
if ($app) {
    echo $app->api_token;
} else {
    echo "NOT_FOUND";
}
