<?php
/**
 * GeoCore Academy — создание курса + URL-активности в Moodle
 * Запускается внутри контейнера geocore_moodle:
 *
 *   docker exec geocore_moodle php /tmp/moodle-create-course.php \
 *     "<name>" "<url>" [category_id]
 *
 * Выводит JSON: {"success":true,"course_id":123}
 */
define('CLI_SCRIPT', true);
define('NO_OUTPUT_BUFFERING', true);

// Отключаем developer debug ДО загрузки Moodle
$_SERVER['HTTP_HOST'] = 'localhost';
require('/var/www/moodle/config.php');

// Заглушаем лишний вывод
$CFG->debug = 0;
$CFG->debugdisplay = 0;
$CFG->debugsmtp = false;

require_once($CFG->dirroot . '/course/modlib.php');
require_once($CFG->dirroot . '/lib/resourcelib.php');

if ($argc < 3) {
    fwrite(STDERR, "Usage: php moodle-create-course.php <name> <url> [category_id]\n");
    exit(1);
}

$name       = $argv[1];
$url        = $argv[2];
$categoryid = isset($argv[3]) ? (int)$argv[3] : 1;

// Устанавливаем контекст admin
$admin = get_admin();
\core\cron::setup_user($admin);

// ── Создать курс (или найти существующий по fullname) ─────────────────────
$existing = $DB->get_record('course', ['fullname' => $name]);
if ($existing) {
    $course = $existing;
} else {
    $coursedata = new stdClass();
    $coursedata->fullname    = $name;
    $coursedata->shortname   = substr(preg_replace('/[^a-zA-Zа-яА-Я0-9]/u', '_', $name), 0, 48)
                               . '_' . substr((string)time(), -4);
    $coursedata->category    = $categoryid;
    $coursedata->visible     = 0;
    $coursedata->summary     = '';
    $coursedata->summaryformat = FORMAT_HTML;
    $coursedata->format      = 'topics';
    $coursedata->numsections = 1;

    $course = create_course($coursedata);
}

// ── Добавить URL-активность ───────────────────────────────────────────────
course_create_sections_if_missing($course, 1);
$moduleid = $DB->get_field('modules', 'id', ['name' => 'url'], MUST_EXIST);

// Проверяем — не добавлена ли уже активность с таким URL
$existing_url = $DB->get_record_sql(
    "SELECT cm.id FROM {course_modules} cm
     JOIN {url} u ON u.id = cm.instance
     WHERE cm.course = ? AND cm.module = ? AND u.externalurl = ?",
    [$course->id, $moduleid, $url]
);

if (!$existing_url) {
    $moduleinfo = new stdClass();
    $moduleinfo->modulename        = 'url';
    $moduleinfo->module            = $moduleid;
    $moduleinfo->name              = $name;
    $moduleinfo->course            = $course->id;
    $moduleinfo->section           = 1;
    $moduleinfo->visible           = 1;
    $moduleinfo->visibleoncoursepage = 1;
    $moduleinfo->groupmode         = 0;
    $moduleinfo->groupingid        = 0;
    $moduleinfo->completion        = 2;
    $moduleinfo->completionview    = 1;
    $moduleinfo->completionexpected = 0;
    $moduleinfo->introformat       = FORMAT_HTML;
    $moduleinfo->intro             = '';
    $moduleinfo->externalurl       = $url;
    $moduleinfo->display           = RESOURCELIB_DISPLAY_NEW;
    $moduleinfo->displayoptions    = serialize([]);
    $moduleinfo->timemodified      = time();
    $moduleinfo->add               = 'url';

    add_moduleinfo($moduleinfo, $course);
}

echo json_encode(['success' => true, 'course_id' => $course->id, 'name' => $name]);
echo "\n";
