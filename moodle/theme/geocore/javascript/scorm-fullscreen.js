(function() {
    if (document.body.id !== 'page-mod-scorm-player') { return; }
    setTimeout(function() {
        window.dispatchEvent(new Event('resize'));
    }, 100);
})();
