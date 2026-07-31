<?php
/**
 * GeoCore-Academy — добавление URL-активности в Moodle курс
 * Запускается внутри Docker контейнера geocore_moodle:
 *
 *   docker cp scripts/moodle-add-url.php geocore_moodle:/tmp/
 *   docker exec geocore_moodle php /tmp/moodle-add-url.php <course_id> "<name>" "<url>"
 */
define('CLI_SCRIPT', true);
require('/var/www/moodle/config.php');
require_once($CFG->dirroot . '/course/modlib.php');
require_once($CFG->dirroot . '/lib/resourcelib.php');

if ($argc < 4) {
    fwrite(STDERR, "Usage: php moodle-add-url.php <course_id> <name> <url>\n");
    exit(1);
}

$courseid = (int)$argv[1];
$name     = $argv[2];
$url      = $argv[3];

// Запускаем от имени администратора
$admin = get_admin();
cron_setup_user($admin);

$course = get_course($courseid);

// Убеждаемся что секция 1 существует
course_create_sections_if_missing($course, 1);

// Получаем module id для 'url'
$moduleid = $DB->get_field('modules', 'id', ['name' => 'url'], MUST_EXIST);

$moduleinfo = new stdClass();
$moduleinfo->modulename       = 'url';
$moduleinfo->module           = $moduleid;
$moduleinfo->name             = $name;
$moduleinfo->course           = $courseid;
$moduleinfo->section          = 1;
$moduleinfo->visible          = 1;
$moduleinfo->visibleoncoursepage = 1;
$moduleinfo->groupmode        = 0;
$moduleinfo->groupingid       = 0;
$moduleinfo->completion       = 2;  // автоматическое завершение
$moduleinfo->completionview   = 1;
$moduleinfo->completionexpected = 0;
$moduleinfo->introformat      = FORMAT_HTML;
$moduleinfo->intro            = '';
$moduleinfo->externalurl      = $url;
$moduleinfo->display          = RESOURCELIB_DISPLAY_NEW;  // открыть в новом окне
$moduleinfo->displayoptions   = serialize([]);
$moduleinfo->timemodified     = time();
$moduleinfo->add              = 'url';

try {
    $result = add_moduleinfo($moduleinfo, $course);
    echo json_encode([
        'success' => true,
        'cmid'    => $result->coursemodule,
        'course'  => $courseid,
        'name'    => $name,
    ]);
    echo "\n";
} catch (Exception $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    echo "\n";
    exit(1);
}
