// GeoCore Academy — fullscreen для SCORM-плеера.
// CSS скрывает хром Moodle, JS пересчитывает высоту iframe.
(function() {
    if (document.body.id !== 'page-mod-scorm-player') {
        return;
    }
    // Даём CSS примениться, потом говорим SCORM JS пересчитать высоту
    setTimeout(function() {
        window.dispatchEvent(new Event('resize'));
    }, 100);
})();
