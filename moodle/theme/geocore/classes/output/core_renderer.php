<?php
// Рендерер темы GeoCore Academy
// Наследует рендерер Boost — без этого Moodle не найдёт методы типа firstview_fakeblocks()
namespace theme_geocore\output;

defined('MOODLE_INTERNAL') || die();

class core_renderer extends \theme_boost\output\core_renderer {
    // Всё наследуется от Boost, кастомизация только через SCSS и mustache-шаблоны
}
