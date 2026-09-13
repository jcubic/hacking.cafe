<?php
/*
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

class RequestCache {
    private $config;
    private $db;
    function __construct($config) {
        $this->config = (object)$config;
        $pristine = !is_file($this->config->CACHE_FILE);
        $this->db = new PDO('sqlite:' . $this->config->CACHE_FILE);
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        if ($pristine) {
            $this->query("CREATE TABLE cache(
                             time DATETIME DEFAULT CURRENT_TIMESTAMP,
                             url VARCHAR(200),
                             code INTEGER,
                             data Text
                         )");
        } else {
            $this->clean();
        }
    }

    // ------------------------------------------------------------------------
    public function fetch($url) {
        $cache = $this->cache($url);
        if (count($cache)) {
            return (object)[
                "body" => $cache[0]['data'],
                "code" => 200
            ];
        }
        $response = $this->curl($url);
        $this->store($url, $response);
        return $response;

    }

    // ------------------------------------------------------------------------
    private function cache($url) {
        return $this->query("SELECT data
                             FROM cache
                             WHERE url = ?", array($url));
    }

    // ------------------------------------------------------------------------
    private function clean() {
        $data = array($this->config->CACHE_TIME / 60 / 24);
        $this->query("DELETE FROM cache WHERE
                      (julianday(CURRENT_TIMESTAMP) - julianday(time)) > ?", $data);
    }

    // ------------------------------------------------------------------------
    private function store($url, $reponse) {
        $data = array(
            $url,
            $reponse->code,
            $reponse->body,
        );
        $query = "INSERT INTO cache (url, code, data) VALUES(?, ?, ?)";
        return $this->query($query, $data) == 1;
    }

    // ------------------------------------------------------------------------
    private function curl($url)  {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_SSH_COMPRESSION, true);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_URL => $url
        ]);
        $result = curl_exec($ch);
        $result = $result;
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return (object)[
            "body" => $result,
            "code" => $code
        ];
    }

    // ------------------------------------------------------------------------
    private function query($query, $data = null) {
        if ($data == null) {
            $res = $this->db->query($query);
        } else {
            $res = $this->db->prepare($query);
            if ($res) {
                if (!$res->execute($data)) {
                    throw Exception("execute query failed");
                }
            } else {
                throw Exception("wrong query");
            }
        }
        if ($res) {
            if (preg_match("/^\s*INSERT|UPDATE|DELETE|ALTER|CREATE|DROP/i", $query)) {
                return $res->rowCount();
            } else {
                return $res->fetchAll(PDO::FETCH_ASSOC);
            }
        } else {
            throw new Exception("Coudn't open file");
        }
    }
}
