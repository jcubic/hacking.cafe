<?php
/*
 *  LightningFS is the PHP-side counterpart to @isomorphic-git/lightning-fs:
 *  it wires CacheFS (the tree) to SQLiteFSBackend (storage) and exposes a
 *  synchronous version of the same read/write file & directory API,
 *  persisting the superblock after every mutation.
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

require_once __DIR__ . '/CacheFS.php';
require_once __DIR__ . '/SQLiteFSBackend.php';
require_once __DIR__ . '/FSExceptions.php';
require_once __DIR__ . '/FSPath.php';

final class LightningFS {
    private $tree;
    private $backend;

    // ------------------------------------------------------------------------
    function __construct($dbPath) {
        $this->backend = new SQLiteFSBackend($dbPath);
        $this->tree = new CacheFS();
        $this->tree->activate($this->backend->loadSuperblock());
    }

    // ------------------------------------------------------------------------
    function stat($filepath) {
        return $this->tree->stat(FSPath::normalize($filepath));
    }

    // ------------------------------------------------------------------------
    function lstat($filepath) {
        return $this->tree->lstat(FSPath::normalize($filepath));
    }

    // ------------------------------------------------------------------------
    function readdir($filepath) {
        return $this->tree->readdir(FSPath::normalize($filepath));
    }

    // ------------------------------------------------------------------------
    function readFile($filepath) {
        $stat = $this->tree->stat(FSPath::normalize($filepath));
        if ($stat['type'] !== 'file') {
            throw new FSIsDirectoryException($filepath);
        }
        return $this->backend->readFile($stat['ino']) ?? '';
    }

    // ------------------------------------------------------------------------
    function writeFile($filepath, $data, $mode = null) {
        $stat = $this->tree->writeStat(FSPath::normalize($filepath), strlen($data), $mode);
        $this->backend->writeFile($stat['ino'], $data);
        $this->save();
        return $stat;
    }

    // ------------------------------------------------------------------------
    function mkdir($filepath, $mode = 0777) {
        $this->tree->mkdir(FSPath::normalize($filepath), $mode);
        $this->save();
    }

    // ------------------------------------------------------------------------
    function rmdir($filepath) {
        $this->tree->rmdir(FSPath::normalize($filepath));
        $this->save();
    }

    // ------------------------------------------------------------------------
    function unlink($filepath) {
        $filepath = FSPath::normalize($filepath);
        $stat = $this->tree->stat($filepath);
        $this->tree->unlink($filepath);
        if ($stat['type'] === 'file') {
            $this->backend->unlink($stat['ino']);
        }
        $this->save();
    }

    // ------------------------------------------------------------------------
    function rename($oldFilepath, $newFilepath) {
        $this->tree->rename(FSPath::normalize($oldFilepath), FSPath::normalize($newFilepath));
        $this->save();
    }

    // ------------------------------------------------------------------------
    function symlink($target, $filepath) {
        $this->tree->symlink(FSPath::normalize($target), FSPath::normalize($filepath));
        $this->save();
    }

    // ------------------------------------------------------------------------
    function readlink($filepath) {
        return $this->tree->readlink(FSPath::normalize($filepath));
    }

    // ------------------------------------------------------------------------
    function du($filepath) {
        return $this->tree->du(FSPath::normalize($filepath));
    }

    // ------------------------------------------------------------------------
    private function save() {
        $this->backend->saveSuperblock($this->tree->getRoot());
    }
}
