<?php
/**
 * GeoCore-Academy — загрузка SCORM ZIP в Moodle как активность
 * Запускается внутри контейнера geocore_moodle:
 *
 *   docker exec geocore_moodle php /tmp/moodle-upload-scorm.php \
 *     "/tmp/course.zip" <course_id> "<title>"
 *
 * Выводит JSON: {"success":true,"cmid":123}
 */
define('CLI_SCRIPT', true);
define('NO_OUTPUT_BUFFERING', true);

$_SERVER['HTTP_HOST'] = 'localhost';
require('/var/www/moodle/config.php');

$CFG->debug        = 0;
$CFG->debugdisplay = 0;
$CFG->debugsmtp    = false;

require_once($CFG->dirroot . '/course/modlib.php');
require_once($CFG->dirroot . '/mod/scorm/lib.php');
require_once($CFG->dirroot . '/mod/scorm/locallib.php');
require_once($CFG->libdir  . '/filelib.php');

if ($argc < 4) {
    fwrite(STDERR, "Usage: php moodle-upload-scorm.php <zip_path> <course_id> <title>\n");
    exit(1);
}

$zip_path  = $argv[1];
$course_id = (int)$argv[2];
$title     = $argv[3];

if (!file_exists($zip_path)) {
    echo json_encode(['success' => false, 'error' => "File not found: $zip_path"]);
    exit(1);
}

$admin = get_admin();
\core\cron::setup_user($admin);

$course = $DB->get_record('course', ['id' => $course_id]);
if (!$course) {
    echo json_encode(['success' => false, 'error' => "Course $course_id not found"]);
    exit(1);
}

// Проверяем — нет ли уже SCORM-активности с таким именем в курсе
$existing = $DB->get_record_sql(
    "SELECT cm.id FROM {course_modules} cm
     JOIN {modules} m ON m.id = cm.module AND m.name = 'scorm'
     JOIN {scorm} s ON s.id = cm.instance
     WHERE cm.course = ? AND s.name = ?",
    [$course_id, $title]
);
if ($existing) {
    echo json_encode(['success' => true, 'cmid' => $existing->id, 'skipped' => true]);
    echo "\n";
    exit(0);
}

// Загружаем ZIP в draft-область файлов Moodle
$usercontext = context_user::instance($admin->id);
$draftid     = file_get_unused_draft_itemid();
$fs          = get_file_storage();
$filerecord  = [
    'contextid'    => $usercontext->id,
    'component'    => 'user',
    'filearea'     => 'draft',
    'itemid'       => $draftid,
    'filepath'     => '/',
    'filename'     => basename($zip_path),
    'timecreated'  => time(),
    'timemodified' => time(),
];
$fs->create_file_from_pathname($filerecord, $zip_path);

// Создаём SCORM-активность в курсе
course_create_sections_if_missing($course, 1);

$scorm_module_id = $DB->get_field('modules', 'id', ['name' => 'scorm'], MUST_EXIST);

$moduleinfo                         = new stdClass();
$moduleinfo->modulename             = 'scorm';
$moduleinfo->module                 = $scorm_module_id;
$moduleinfo->name                   = $title;
$moduleinfo->course                 = $course_id;
$moduleinfo->section                = 1;
$moduleinfo->visible                = 1;
$moduleinfo->intro                  = '';
$moduleinfo->introformat            = FORMAT_HTML;
$moduleinfo->packagefile            = $draftid;
$moduleinfo->scormtype              = SCORM_TYPE_LOCAL;
$moduleinfo->popup                  = 0;
$moduleinfo->width                  = 100;
$moduleinfo->height                 = 500;
$moduleinfo->skipview               = SCORM_SKIPVIEW_NEVER;
$moduleinfo->hidebrowse             = 0;
$moduleinfo->displayattemptstatus   = SCORM_DISPLAY_ATTEMPTSTATUS_ALL;
$moduleinfo->displaycoursestructure = 0;
$moduleinfo->updatefreq             = SCORM_UPDATE_NEVER;
$moduleinfo->maxgrade               = 100;
$moduleinfo->grademethod            = GRADEHIGHEST;
$moduleinfo->maxattempt             = 0;
$moduleinfo->forcenewattempt        = SCORM_FORCEATTEMPT_NO;
$moduleinfo->timeopen               = 0;
$moduleinfo->timeclose              = 0;
$moduleinfo->completion             = 2;
$moduleinfo->completionview         = 1;
$moduleinfo->completionexpected     = 0;
$moduleinfo->groupmode              = 0;
$moduleinfo->groupingid             = 0;
$moduleinfo->add                    = 'scorm';

try {
    $cm = add_moduleinfo($moduleinfo, $course);
    echo json_encode(['success' => true, 'cmid' => $cm->coursemodule]);
    echo "\n";
} catch (Exception $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    echo "\n";
}
