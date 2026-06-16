<?php
// Возвращает дополнительный SCSS который применяется поверх Boost
function theme_geocore_get_extra_scss($theme) {
    $scss = file_get_contents(__DIR__ . '/scss/post.scss');
    return $scss;
}

// Подключает Google Fonts через <link> в <head> (scssphp не умеет @import url())
function theme_geocore_page_init($page) {
    $fontsurl = 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900' .
                '&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap';
    $page->requires->css(new moodle_url($fontsurl));
}
