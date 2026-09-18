<?php
/*
 *  JSON-RPC service - Main API for Hacking Cafe
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

require __DIR__ . '/vendor/autoload.php';
require __DIR__ . '/lib/RequestCache.php';
require __DIR__ . '/lib/utils.php';

use Jcubic\JsonRpc\Server;

// CORS: the Vite dev server runs on a different port
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Accept');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit();
}

class Service extends RequestCache {
    private PDO $fs_db;

    function __construct() {
        parent::__construct(array(
            'CACHE_FILE' => 'cache.db',
            'CACHE_TIME' => 48
        ));
        $fs = __DIR__ . '/fs.db';
        $pristine = !is_file($fs);
        $this->fs_db = new PDO('sqlite:' . $fs);
        $this->fs_db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        if ($pristine) {
            $this->fs_db->exec('CREATE TABLE IF NOT EXISTS fs(
                                   name TEXT PRIMARY KEY,
                                   data BLOB
                               )');
        }
    }

    // ------------------------------------------------------------------------
    function jargon_list() {
        $db = new PDO('sqlite:jargon.db');
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $res = $db->query("SELECT term FROM terms");
        if ($res) {
            return array_map(function($term) {
                return $term['term'];
            }, $res->fetchAll());
        } else {
            return array();
        }
    }

    // ------------------------------------------------------------------------
    public function get($url, $use_cache = false) {
        $result = $this->fetch($url, $use_cache);
        if ($result->code == 200) {
            return $result->body;
        }
        return NULL;
    }

    // ------------------------------------------------------------------------
    public function ip() {
        if (isset($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            return $_SERVER['HTTP_X_FORWARDED_FOR'];
        }

        $ip = $_SERVER['REMOTE_ADDR'];

        if ($ip === '::1' || $ip === '127.0.0.1') {
            $result = json_decode($this->get('https://api.ipify.org?format=json'));
            return $result->ip;
        }

        return $ip;
    }

    // ------------------------------------------------------------------------
    public function location() {
        $env = parse_ini_file('.env');
        $api_key = $env['GEO_IP_API_KEY'];
        $ip = $this->ip();
        $url = "https://api.ip2location.io/?key=$api_key&&ip=$ip";
        return json_decode($this->get($url, true));
    }

    // ------------------------------------------------------------------------
    function jargon_search($search_term) {
        $db = new PDO('sqlite:' . __DIR__ . '/jargon/jargon.db');
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $search_term = $db->quote($search_term);
        $res = $db->query("SELECT term FROM terms WHERE term like $search_term or ".
                          "def like $search_term");
        $result = $res->fetchAll(PDO::FETCH_ASSOC);

        return $result;
    }

    // ------------------------------------------------------------------------
    function jargon($search_term) {
        $db = new PDO('sqlite:' . __DIR__ . '/jargon/jargon.db');
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $search_term = $db->quote($search_term);
        $res = $db->query("SELECT * FROM terms WHERE term like $search_term");
        $result = array();
        if ($res) {
            $result = $res->fetchAll(PDO::FETCH_ASSOC);
            foreach($result as &$term) {
                $query = "SELECT name FROM abbrev WHERE term = " . $term['id'];
                $res = $db->query($query);
                if ($res) {
                    $abbr_array = $res->fetchAll(PDO::FETCH_ASSOC);
                    if (!empty($abbr_array)) {
                        foreach ($abbr_array as $abbr) {
                            $term['abbr'][] = $abbr['name'];
                        }
                    }
                }
            }
        }
        return $result;
    }

    // ------------------------------------------------------------------------
    public function rfc($number) {
        if ($number == null) {
            $url = "https://www.rfc-editor.org/rfc-index.txt";
            $page = $this->get($url);
            $page = preg_replace("/(^[0-9]+)/m", '[[!bu;#fff;;rfc]$1]', $page);
        } else {
            $number = preg_replace("/^0+/", "", $number);
            $url = "https://www.rfc-editor.org/rfc/rfc$number.txt";
            $page = $this->get($url);
        }
        return $page ? mb_convert_encoding($page, 'UTF-8', 'UTF-8') : null;
    }

    // ------------------------------------------------------------------------
    public function fs_get($name) {
        $stmt = $this->fs_db->prepare('SELECT data FROM fs WHERE name = ?');
        $stmt->execute([$name]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        // data is base64 encoded, so it can hold binary files
        return $row ? base64_encode($row['data']) : null;
    }

    // ------------------------------------------------------------------------
    public function fs_set($name, $data) {
        $binary = base64_decode($data, true);
        if ($binary === false) {
            throw new \Jcubic\JsonRpc\JsonRpcException(106, 'fs_set: data is not valid base64');
        }
        $stmt = $this->fs_db->prepare('INSERT OR REPLACE INTO fs(name, data) VALUES(?, ?)');
        $stmt->bindValue(1, $name);
        $stmt->bindValue(2, $binary, PDO::PARAM_LOB);
        $stmt->execute();
        return true;
    }

    // ------------------------------------------------------------------------
    public function fs_delete($name) {
        $stmt = $this->fs_db->prepare('DELETE FROM fs WHERE name = ?');
        $stmt->execute([$name]);
        return $stmt->rowCount() > 0;
    }

    // ------------------------------------------------------------------------
    public function init_list() {
        $lists = read_all_files('.' . DIRECTORY_SEPARATOR . 'fs' . DIRECTORY_SEPARATOR);
        if (is_dev_server()) {
            // in production these are already excluded by vite.config.ts's
            // copy targets, so they never reach the deployed api/fs directory;
            // the dev server serves api/fs straight from disk, so filter here
            $lists['files'] = array_values(array_filter($lists['files'], function($path) {
                $name = basename($path);
                return $name !== '.gitkeep' && !preg_match('/~$|^#.*#$/', $name);
            }));
        }
        foreach ($lists as $name => $list) {
            $lists[$name] = array_map(function($path) {
                return preg_replace("%\\./fs%", "", $path);
            }, $list);
        }
        return $lists;
    }

    // ------------------------------------------------------------------------
    public function init_read($file) {
        $root = realpath(__DIR__ . '/fs');
        $path = realpath(__DIR__ . '/fs' . $file);
        $in_root = $path !== false && strncmp($path, $root . DIRECTORY_SEPARATOR, strlen($root) + 1) === 0;
        if (!$in_root) {
            throw new \Jcubic\JsonRpc\JsonRpcException(104, "init_read: invalid path '$file'");
        }
        return file_get_contents($path);
    }
}

(new Server(new Service()))->handle();
