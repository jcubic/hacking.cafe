<?php

/**
 * True only when running under PHP's built-in development server
 * (php -S ...), never under Apache/mod_php or PHP-FPM in production.
 */
function is_dev_server() {
    return php_sapi_name() === 'cli-server';
}

/**
 * Finds path, relative to the given root folder, of all files and directories in the given directory and its sub-directories non recursively.
 * Will return an array of the form
 * array(
 *   'files' => [],
 *   'dirs'  => [],
 * )
 * @author sreekumar
 * @param string $root
 * @result array
 */
// source: https://www.php.net/manual/en/function.readdir.php
function read_all_files($root = '.') {
    $files  = array(
        'files' => array(),
        'dirs' => array()
    );
  $directories = array();
  $last_letter = $root[strlen($root)-1];
  $root = ($last_letter == '\\' || $last_letter == '/') ? $root : $root.DIRECTORY_SEPARATOR;

  $directories[]  = $root;

  while (sizeof($directories)) {
    $dir  = array_pop($directories);
    if ($handle = opendir($dir)) {
      while (false !== ($file = readdir($handle))) {
        if ($file == '.' || $file == '..') {
          continue;
        }
        $file  = $dir.$file;
        if (is_dir($file)) {
          $directory_path = $file.DIRECTORY_SEPARATOR;
          array_push($directories, $directory_path);
          $files['dirs'][]  = $directory_path;
        } elseif (is_file($file)) {
          $files['files'][]  = $file;
        }
      }
      closedir($handle);
    }
  }

  return $files;
}
