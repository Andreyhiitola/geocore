// GeoCore Academy — почти-fullscreen для SCORM-плеера.
// Подключается на каждой странице через $THEME->javascripts_footer,
// но что-то делает только на #page-mod-scorm-player (хром Moodle
// скрыт через CSS в theme/geocore/scss/post.scss).
(function() {
    if (document.body.id !== 'page-mod-scorm-player') {
        return;
    }

    // После того как CSS скрыл навбар/футер, пересчитываем высоту плеера
    // (M.mod_scorm.init слушает window.resize и берёт реальные размеры/отступы).
    window.dispatchEvent(new Event('resize'));

    var exitbar = document.querySelector('#region-main .d-flex.flex-row-reverse.mb-2');
    var target = document.getElementById('scormpage') || document.documentElement;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary geocore-scorm-fullscreen-btn';

    var setLabel = function() {
        btn.textContent = document.fullscreenElement
            ? '✕ Выйти из полноэкранного'
            : '⛶ Во весь экран';
    };
    setLabel();

    btn.addEventListener('click', function() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
            return;
        }
        if (!target.requestFullscreen) {
            return;
        }
        var request = target.requestFullscreen();
        if (request && request.catch) {
            request.catch(function() {});
        }
    });

    document.addEventListener('fullscreenchange', function() {
        setLabel();
        window.dispatchEvent(new Event('resize'));
    });

    if (exitbar) {
        exitbar.classList.add('geocore-scorm-exitbar');
        exitbar.appendChild(btn);
    } else {
        document.body.appendChild(btn);
    }
})();
