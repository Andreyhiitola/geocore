<?php
// Конфигурация темы GeoCore Academy
// Дочерняя тема на основе Boost — наследует всё, переопределяет стили и шаблоны
defined('MOODLE_INTERNAL') || die();

$THEME->name        = 'geocore';
$THEME->fullname    = 'GeoCore Academy';
$THEME->parents     = ['boost'];
$THEME->sheets      = [];
$THEME->enable_dock = false;
$THEME->usefallback = true;

// Подключаем наш SCSS поверх Boost
$THEME->extrascsscallback = 'theme_geocore_get_extra_scss';
