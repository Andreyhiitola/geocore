<?php
global $CFG;
$CFG = new stdClass();
$CFG->dbtype    = 'mariadb';
$CFG->dbhost    = 'mariadb';
$CFG->dbname    = 'moodle';
$CFG->dbuser    = 'moodle';
$CFG->dbpass    = 'moodlepass123';
$CFG->prefix    = 'mdl_';
$CFG->wwwroot   = 'http://localhost:8080';
$CFG->dataroot  = '/var/moodledata';
$CFG->directorypermissions = 0777;
require_once(__DIR__ . '/lib/setup.php');
