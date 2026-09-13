<?php
/*
 *  HTTP view of the LightningFS filesystem stored in fs.db:
 *
 *  GET    /api/fs.php?path=/a/file                    -> raw file content
 *  GET    /api/fs.php?path=/a/dir                      -> JSON directory listing
 *  PUT    /api/fs.php?path=/a/file  (body = content)   -> create/overwrite a file
 *  POST   /api/fs.php?path=/a/dir&action=mkdir          -> create a directory
 *  POST   /api/fs.php?path=/old&action=rename&to=/new   -> rename/move
 *  POST   /api/fs.php?path=/link&action=symlink&target=/a/file -> create a symlink
 *  DELETE /api/fs.php?path=/a/file-or-empty-dir         -> unlink/rmdir
 *
 *  This is the same fs.db that api/index.php's fs_get/fs_set/fs_delete
 *  JSON-RPC methods read and write for the browser's LightningFS, so
 *  changes made here are immediately visible there and vice versa.
 *
 *  Copyright (c) 2026 Jakub T. Jankiewicz <https://jakub.jankiewicz.org>
 *
 *  This file is part of Hacking Cafe.
 *
 *  Hacking Cafe is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU Affero General Public License as published by
 *  the Free Software Foundation; either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  Hacking Cafe is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Affero General Public License for more details.
 *
 *  You should have received a copy of the GNU Affero General Public License
 *  along with Hacking Cafe.  If not, see <http://www.gnu.org/licenses/>.
 *
 */
require __DIR__ . '/fs/LightningFS.php';

// CORS: the Vite dev server runs on a different port
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, PUT, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Accept');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit();
}

// ------------------------------------------------------------------------
function guess_mime_type($path) {
    $extensions = [
        'html' => 'text/html', 'htm' => 'text/html',
        'css' => 'text/css',
        'js' => 'text/javascript', 'mjs' => 'text/javascript',
        'json' => 'application/json',
        'txt' => 'text/plain', 'md' => 'text/markdown',
        'xml' => 'application/xml',
        'svg' => 'image/svg+xml',
        'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
        'gif' => 'image/gif', 'webp' => 'image/webp', 'ico' => 'image/x-icon',
        'pdf' => 'application/pdf',
    ];
    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    return $extensions[$ext] ?? 'application/octet-stream';
}

// ------------------------------------------------------------------------
function normalize_request_path($path) {
    if ($path === null || $path === '') {
        return '/';
    }
    if ($path[0] !== '/') {
        $path = '/' . $path;
    }
    if (strlen($path) > 1 && substr($path, -1) === '/') {
        $path = rtrim($path, '/');
    }
    return $path;
}

// ------------------------------------------------------------------------
/** Octal mode string from a query param (eg. "755") -> int; null when absent. */
function parse_mode($raw) {
    return $raw === null || $raw === '' ? null : intval($raw, 8);
}

// ------------------------------------------------------------------------
function send_json($body, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($body);
}

// ------------------------------------------------------------------------
/** Maps an FSException to the HTTP status that best describes it. */
function fs_exception_status(FSException $e) {
    if ($e instanceof FSNotFoundException) {
        return 404;
    }
    if ($e instanceof FSExistsException || $e instanceof FSNotEmptyException) {
        return 409;
    }
    return 400;
}

// ------------------------------------------------------------------------
function handle_get(LightningFS $fs, $path) {
    $stat = $fs->stat($path);

    if ($stat['type'] === 'dir') {
        $entries = [];
        foreach ($fs->readdir($path) as $name) {
            $childPath = $path === '/' ? "/$name" : "$path/$name";
            // lstat, not stat: a dangling symlink must still be listed
            // (with its own metadata) rather than breaking the whole listing
            $childStat = $fs->lstat($childPath);
            $entries[] = [
                'name' => $name,
                'type' => $childStat['type'],
                'size' => $childStat['size'],
                'mode' => $childStat['mode'],
                'mtimeMs' => $childStat['mtimeMs'],
            ];
        }
        usort($entries, function($a, $b) {
            return strcmp($a['name'], $b['name']);
        });
        send_json(['path' => $path, 'type' => 'dir', 'entries' => $entries]);
        return;
    }

    if ($stat['type'] === 'file') {
        $data = $fs->readFile($path);
        header('Content-Type: ' . guess_mime_type($path));
        header('Content-Length: ' . strlen($data));
        echo $data;
        return;
    }

    // symlink or other non-file/dir node: report the stat instead of content
    send_json(['path' => $path, 'type' => $stat['type'], 'stat' => $stat]);
}

// ------------------------------------------------------------------------
function handle_put(LightningFS $fs, $path) {
    if ($path === '/') {
        send_json(['error' => "EISDIR: illegal operation on a directory, '/'"], 400);
        return;
    }
    $data = file_get_contents('php://input');
    $mode = parse_mode($_GET['mode'] ?? null);
    $stat = $fs->writeFile($path, $data, $mode);
    send_json(['path' => $path, 'type' => 'file', 'stat' => $stat], 200);
}

// ------------------------------------------------------------------------
function handle_post(LightningFS $fs, $path) {
    $action = $_GET['action'] ?? null;

    if ($action === 'mkdir') {
        $mode = parse_mode($_GET['mode'] ?? null) ?? 0777;
        $fs->mkdir($path, $mode);
        send_json(['path' => $path, 'type' => 'dir', 'stat' => $fs->stat($path)], 201);
        return;
    }

    if ($action === 'rename') {
        $to = normalize_request_path($_GET['to'] ?? null);
        $fs->rename($path, $to);
        send_json(['from' => $path, 'to' => $to], 200);
        return;
    }

    if ($action === 'symlink') {
        $target = $_GET['target'] ?? null;
        if ($target === null || $target === '') {
            send_json(['error' => "symlink requires a 'target' parameter"], 400);
            return;
        }
        $fs->symlink($target, $path);
        send_json(['path' => $path, 'type' => 'symlink', 'target' => $target], 201);
        return;
    }

    send_json(['error' => "unknown action '$action'; expected mkdir, rename or symlink"], 400);
}

// ------------------------------------------------------------------------
function handle_delete(LightningFS $fs, $path) {
    if ($path === '/') {
        send_json(['error' => "cannot delete the filesystem root"], 400);
        return;
    }
    $stat = $fs->stat($path);
    if ($stat['type'] === 'dir') {
        $fs->rmdir($path);
    } else {
        $fs->unlink($path);
    }
    send_json(['path' => $path, 'deleted' => true], 200);
}

// ------------------------------------------------------------------------

$path = normalize_request_path($_GET['path'] ?? null);
$fs = new LightningFS(__DIR__ . '/fs.db');
$method = $_SERVER['REQUEST_METHOD'];

try {
    switch ($method) {
        case 'GET':
            handle_get($fs, $path);
            break;
        //case 'PUT':
        //    handle_put($fs, $path);
        //    break;
        //case 'POST':
        //    handle_post($fs, $path);
        //    break;
        //case 'DELETE':
        //    handle_delete($fs, $path);
        //    break;
        default:
            send_json(['error' => "method $method not allowed"], 405);
    }
} catch (FSException $e) {
    send_json(['error' => $e->getMessage(), 'path' => $path], fs_exception_status($e));
}
