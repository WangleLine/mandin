(function() {
    let open = false;
    let winbox = null;

    let SettingsWindow = {};

    function openWindow() {
        if (open) return;
        open = true;
        Settings.saveWindowOpen("settings", true);

        let size = Settings.getWindowSize("settings", 60, 60, 240, 140);
        winbox = new WinBox("Settings", {
            mount: document.querySelector("div.wb#settings"),
            onclose: () => {
                open = false;
                Settings.saveWindowOpen("settings", false);
            },
            x:size.x,
            y:size.y,
            width:size.w,
            height:size.h,
            onresize: (w, h) => {
                Settings.saveWindowWH("settings", w, h)
            },
            onmove: (x, y) => {
                Settings.saveWindowXY("settings", x, y)
            }
        });

        // make the controls reflect the saved settings whenever we open
        let verbose = document.querySelector("#setting_verbose");
        if (verbose) verbose.checked = Settings.loadValue("verbose", false);
    }
    SettingsWindow.openWindow = openWindow;

    // verbose toggle, persists to settings.cfg, picked up by vlog()
    let verboseBox = document.querySelector("#setting_verbose");
    if (verboseBox) {
        verboseBox.checked = Settings.loadValue("verbose", false);
        verboseBox.addEventListener("change", () => {
            Settings.saveValue("verbose", verboseBox.checked);
            log("Verbose logging " + (verboseBox.checked ? "ON - prepare for spammmm!" : "OFF"));
        });
    }

    document.querySelector("#btn_settings").addEventListener("click", openWindow);

    window.SettingsWindow = SettingsWindow;
})();
