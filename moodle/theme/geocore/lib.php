<?php
// Возвращает дополнительный SCSS который применяется поверх Boost
function theme_geocore_get_extra_scss($theme) {
    $scss = file_get_contents(__DIR__ . '/scss/post.scss');
    return $scss;
}
