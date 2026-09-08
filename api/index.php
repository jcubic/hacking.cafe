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

class Service {
    private PDO $fs_db;

    function __construct() {
        $this->fs_db = new PDO('sqlite:' . __DIR__ . '/fs.db');
        $this->fs_db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->fs_db->exec('CREATE TABLE IF NOT EXISTS fs(name TEXT PRIMARY KEY, data BLOB)');
    }
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
    public function get($url) {
        $ch = $this->curl($url);
        $result = curl_exec($ch);
        $info = curl_getinfo($ch);
        curl_close($ch);
        if ($info['http_code'] == 200) {
            return $result;
        } else {
            return NULL;
        }
    }

    // ------------------------------------------------------------------------
    private function curl($url) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, 1);
        curl_setopt($ch, CURLOPT_HEADER, 0);
        if (isset($_SERVER['HTTP_USER_AGENT'])) {
            $agent = $_SERVER['HTTP_USER_AGENT'];
        } else {
            // defaut FireFox 15 from agent switcher (google chrome extension)
            $agent = 'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:15.0) Gecko/20120427 '.
                     'Firefox/15.0a1';
        }
        curl_setopt($ch, CURLOPT_USERAGENT, $agent);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
        return $ch;
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

    public function fs_get($name) {
        $stmt = $this->fs_db->prepare('SELECT data FROM fs WHERE name = ?');
        $stmt->execute([$name]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        // data is base64 encoded, so it can hold binary files
        return $row ? base64_encode($row['data']) : null;
    }
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
    public function fs_delete($name) {
        $stmt = $this->fs_db->prepare('DELETE FROM fs WHERE name = ?');
        $stmt->execute([$name]);
        return $stmt->rowCount() > 0;
    }
    // ------------------------------------------------------------------------
    public function hello($name) {
        return "hello, <white>$name</white>!";
    }
}

(new Server(new Service()))->handle();
