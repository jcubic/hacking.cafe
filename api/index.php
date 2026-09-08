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
    // ------------------------------------------------------------------------
    public function hello($name) {
        return "hello, <white>$name</white>!";
    }
}

(new Server(new Service()))->handle();
