<?php
/*
  Development JSON-RPC echo service for hacking.cafe
  Copyright (C) 2026 Jakub T. Jankiewicz <https://jcubic.pl>

  Released under the AGPL-3.0 license
*/

require __DIR__ . '/vendor/autoload.php';

use Jcubic\JsonRpc\Server;

// CORS: the Vite dev server runs on a different port
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Accept');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit();
}

class EchoService {
    public function hello($name) {
        return "hello, $name!";
    }
    public static $hello_documentation = "return greeting for given name";
}

(new Server(new EchoService()))->handle();
