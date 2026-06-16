(function() {
    if (document.body.id !== 'page-mod-scorm-player') { return; }

    var IDS = ['scormpage', 'tocbox', 'scorm_layout', 'scorm_content'];
    var NAV_ID = 'scorm_nav';

    function applyHeights() {
        var nav = document.getElementById(NAV_ID);
        var navH = (nav && nav.offsetHeight) ? nav.offsetHeight : 0;
        var h = window.innerHeight - navH;

        IDS.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.style.setProperty('height', h + 'px', 'important');
        });

        var obj = document.getElementById('scorm_object');
        if (obj) {
            obj.style.setProperty('width', '100%', 'important');
            obj.style.setProperty('height', '100%', 'important');
        }
    }

    // Запускаем сразу и через таймауты чтобы перебить SCORM JS
    applyHeights();
    setTimeout(applyHeights, 100);
    setTimeout(applyHeights, 500);
    setTimeout(applyHeights, 1000);

    window.addEventListener('resize', applyHeights);

    // MutationObserver следит за изменениями высоты от SCORM JS и восстанавливает
    function watchElement(id) {
        var el = document.getElementById(id);
        if (!el) { return; }
        new MutationObserver(function(mutations) {
            mutations.forEach(function(m) {
                if (m.attributeName === 'style') { applyHeights(); }
            });
        }).observe(el, { attributes: true });
    }

    IDS.forEach(watchElement);
    watchElement('scorm_object');
})();
