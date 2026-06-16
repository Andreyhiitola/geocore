// GeoCore Academy — fullscreen для SCORM-плеера.
(function() {
    if (document.body.id !== 'page-mod-scorm-player') {
        return;
    }

    setTimeout(function() {
        window.dispatchEvent(new Event('resize'));
    }, 100);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn geocore-fs-btn';
    btn.style.cssText = [
        'position:fixed',
        'bottom:12px',
        'right:12px',
        'z-index:10000',
        'background:rgba(0,0,0,0.55)',
        'color:#fff',
        'border:none',
        'border-radius:0',
        'padding:6px 12px',
        'font-size:11px',
        'letter-spacing:0.08em',
        'text-transform:uppercase',
        'cursor:pointer',
    ].join(';');

    function setLabel() {
        btn.textContent = document.fullscreenElement ? '✕ Выйти' : '⛶ Во весь экран';
    }
    setLabel();

    btn.addEventListener('click', function() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            document.documentElement.requestFullscreen().catch(function() {});
        }
    });

    document.addEventListener('fullscreenchange', function() {
        setLabel();
        window.dispatchEvent(new Event('resize'));
    });

    document.body.appendChild(btn);
})();
