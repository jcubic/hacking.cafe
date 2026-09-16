<?php
/*
 *  SQLiteFSBackend mirrors RPCBackend from src/fs.ts, reading and writing
 *  the same `fs` table that api/index.php's fs_get/fs_set/fs_delete
 *  methods use for the JSON-RPC-backed LightningFS in the browser.
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

require_once __DIR__ . '/FSSerializer.php';

final class SQLiteFSBackend {
    private $db;

    // ------------------------------------------------------------------------
    function __construct($path) {
        $this->db = new PDO('sqlite:' . $path);
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->db->exec('CREATE TABLE IF NOT EXISTS fs(name TEXT PRIMARY KEY, data BLOB)');
    }

    // ------------------------------------------------------------------------
    /** Load the superblock (an FSNode tree) on startup; null when the fs is fresh. */
    function loadSuperblock() {
        $raw = $this->get('!root');
        return $raw === null ? null : FSSerializer::deserialize($raw);
    }

    // ------------------------------------------------------------------------
    /** Persist the superblock (an FSNode tree). */
    function saveSuperblock(FSNode $tree) {
        $this->set('!root', FSSerializer::serialize($tree));
    }

    // ------------------------------------------------------------------------
    /** Read raw file bytes by inode key. */
    function readFile($ino) {
        $raw = $this->get((string)$ino);
        return $raw === null ? null : FSSerializer::deserialize($raw);
    }

    // ------------------------------------------------------------------------
    /** Write raw file bytes by inode key. */
    function writeFile($ino, $data) {
        $this->set((string)$ino, FSSerializer::serialize($data));
    }

    // ------------------------------------------------------------------------
    /** Delete a file by inode key. */
    function unlink($ino) {
        $stmt = $this->db->prepare('DELETE FROM fs WHERE name = ?');
        $stmt->execute([(string)$ino]);
    }

    // ------------------------------------------------------------------------
    private function get($name) {
        $stmt = $this->db->prepare('SELECT data FROM fs WHERE name = ?');
        $stmt->execute([$name]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ? $row['data'] : null;
    }

    // ------------------------------------------------------------------------
    private function set($name, $raw) {
        $stmt = $this->db->prepare('INSERT OR REPLACE INTO fs(name, data) VALUES(?, ?)');
        $stmt->bindValue(1, $name);
        $stmt->bindValue(2, $raw, PDO::PARAM_LOB);
        $stmt->execute();
    }
}
