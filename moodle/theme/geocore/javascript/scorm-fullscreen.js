// GeoCore-Academy — fullscreen для SCORM-плеера.
// CSS скрывает хром Moodle, JS вписывает контент CourseLab (фиксированная
// пиксельная вёрстка) в реальный размер iframe — иначе нижний тулбар
// SCORM-курса уезжает за видимую область на экранах, где он выше
// доступной высоты.
(function() {
    if (document.body.id !== 'page-mod-scorm-player') {
        return;
    }

    var lastIframe = null;

    // CourseLab верстает каждый слайд как .cl-container фиксированного
    // размера (обычно 1440x900), который сам себя центрирует через
    // position:absolute + отрицательный margin на 50%/50% относительно
    // body — и это не меняется ни от слайда, ни от размера окна.
    // offsetWidth/offsetHeight — это размер ДО применения transform (в
    // отличие от getBoundingClientRect, который раньше использовался: он
    // показывает экранные координаты ПОСЛЕ transform и центрирования, а
    // те зависят от текущего размера body/iframe — на разных мониторах
    // получался разный и порой завышенный "естественный" размер, из-за
    // чего контент мог вылезать за пределы iframe вместо того, чтобы
    // вписаться в него.
    function fitScoContent(iframe) {
        var doc;
        try {
            doc = iframe.contentDocument;
        } catch (e) {
            return; // другой origin — не наш случай, но не должно ронять страницу
        }
        if (!doc) {
            return;
        }
        var stage = doc.querySelector('.cl-container');
        if (!stage) {
            return;
        }
        var naturalW = stage.offsetWidth;
        var naturalH = stage.offsetHeight;
        if (!naturalW || !naturalH) {
            return;
        }
        var scale = Math.min(iframe.clientWidth / naturalW, iframe.clientHeight / naturalH);
        if (!isFinite(scale) || scale <= 0) {
            return;
        }
        // .cl-container уже центрирован сам по себе (см. выше) — transform
        // с дефолтным transform-origin (центр) масштабирует его на месте,
        // без сдвигов и без правок body/margin.
        stage.style.transform = 'scale(' + scale + ')';
    }

    function onResize() {
        if (lastIframe) {
            fitScoContent(lastIframe);
        }
    }

    function watchScormObject() {
        var iframe = document.getElementById('scorm_object');
        if (!iframe || iframe === lastIframe) {
            return;
        }
        lastIframe = iframe;

        var scheduleFit = function() {
            // Контент SCO иногда догружается асинхронно — пересчитываем дважды.
            setTimeout(function() { fitScoContent(iframe); }, 200);
            setTimeout(function() { fitScoContent(iframe); }, 800);
            // Переключение слайдов внутри SCO — это JS-навигация в той же
            // странице (НАЗАД/ДАЛЕЕ), без перезагрузки iframe, поэтому следим
            // за высотой контента периодически, а не только по load/resize.
            clearInterval(iframe._geocoreFitInterval);
            iframe._geocoreFitInterval = setInterval(function() {
                fitScoContent(iframe);
            }, 700);
        };

        // iframe мог успеть загрузиться ДО того, как мы повесили слушатель —
        // тогда событие load уже не повторится, и без этой проверки fitScoContent
        // никогда бы не вызвался.
        var doc = null;
        try {
            doc = iframe.contentDocument;
        } catch (e) {
            doc = null;
        }
        if (doc && doc.readyState === 'complete') {
            scheduleFit();
        }

        iframe.addEventListener('load', scheduleFit);
    }

    window.addEventListener('resize', onResize);

    // Даём CSS примениться, потом говорим SCORM JS пересчитать высоту
    setTimeout(function() {
        window.dispatchEvent(new Event('resize'));
        watchScormObject();
    }, 100);

    // module.js пересоздаёт #scorm_object при переходе между SCO — следим за этим.
    new MutationObserver(watchScormObject).observe(document.body, {childList: true, subtree: true});
})();
