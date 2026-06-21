// GeoCore Academy — fullscreen для SCORM-плеера.
// CSS скрывает хром Moodle, JS пересчитывает высоту iframe и вписывает
// контент CourseLab (фиксированная пиксельная вёрстка) в реальный размер
// iframe — иначе нижний тулбар SCORM-курса уезжает за видимую область
// на экранах, где он выше доступной высоты.
(function() {
    if (document.body.id !== 'page-mod-scorm-player') {
        return;
    }

    var lastIframe = null;

    // scrollWidth/scrollHeight ненадёжны: у CourseLab часто overflow:hidden
    // на body, и scrollHeight показывает обрезанный (видимый) размер, а не
    // настоящую высоту вёрстки. Поэтому меряем по реальным координатам
    // элементов — getBoundingClientRect не зависит от overflow родителя.
    function measureNatural(doc) {
        var maxRight = 0, maxBottom = 0;
        var all = doc.body.getElementsByTagName('*');
        for (var i = 0; i < all.length; i++) {
            var r = all[i].getBoundingClientRect();
            if (r.right > maxRight) { maxRight = r.right; }
            if (r.bottom > maxBottom) { maxBottom = r.bottom; }
        }
        return [maxRight, maxBottom];
    }

    // CourseLab-курсы внутри одного SCO часто устроены как одна HTML-страница
    // с десятками слайдов (показ/скрытие div'ов через JS), у каждого слайда
    // может быть своя высота — поэтому "натуральный" размер нельзя смерить
    // один раз и закэшировать навсегда, измеряем каждый раз заново. Чтобы не
    // сбрасывать transform на 'none' (это даёт видимый мерцающий скачок),
    // снимаем уже отмасштабированные координаты и делим на предыдущий scale.
    function fitScoContent(iframe) {
        var doc;
        try {
            doc = iframe.contentDocument;
        } catch (e) {
            return; // другой origin — не наш случай, но не должно ронять страницу
        }
        if (!doc || !doc.body) {
            return;
        }
        var body = doc.body;
        var prevScale = parseFloat(body.dataset.geocoreScale) || 1;
        var natural = measureNatural(doc);
        var naturalW = natural[0] / prevScale;
        var naturalH = natural[1] / prevScale;
        if (!naturalW || !naturalH) {
            return;
        }
        var scale = Math.min(iframe.clientWidth / naturalW, iframe.clientHeight / naturalH);
        if (!isFinite(scale) || scale <= 0) {
            return;
        }
        body.dataset.geocoreScale = scale;
        body.style.transformOrigin = 'top center';
        // Ширина в px (не в %) — чтобы сам пересчёт scale не меняв layout
        // не вызывал реflow текста, а тот не менял naturalH на следующем тике
        // (иначе scale и высота контента гоняют друг друга по кругу).
        body.style.width = naturalW + 'px';
        body.style.margin = '0 auto';
        body.style.transform = 'scale(' + scale + ')';
        body.style.overflow = 'hidden';
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
