(function() {
    let open = false;
    let winbox = null;
    let cachedRooms = null;
    let thumbnailCache = {};   // room -> dataURL
    let thumbnailHashes = {};  // room -> content hash of the .yy it was rendered from
    let verified = {};         // room -> true once its hash has been checked this session
    let thumbQueue = [];
    let activeThumbs = 0;
    let thumbObserver = null;
    const MAX_CONCURRENT_THUMBS = 3;

    // Persistent thumbnail cache
    const THUMB_CACHE_FILE = "roomthumbnails.json";
    let thumbCacheLoaded = false;
    let saveTimer = null;

    let RoomPicker = {};

    // cyrb53 fast 53-bit non-crypto hash
    function cyrb53(str) {
        let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
        for (let i = 0, ch; i < str.length; i++) {
            ch = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
        h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
        h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return 4294967296 * (2097151 & h2) + (h1 >>> 0);
    }

    // fingerprint of a room's content... parse+stringify normalises away pure formatting/whitespace changes
    function roomHash(roomData) {
        return cyrb53(JSON.stringify(roomData));
    }

    function ensureThumbCacheLoaded(callback) {
        if (thumbCacheLoaded) { callback(); return; }
        Engine.fileExists(THUMB_CACHE_FILE, (exists) => {
            if (!exists) { thumbCacheLoaded = true; callback(); return; }
            Engine.fileReadText(THUMB_CACHE_FILE, (text) => {
                try {
                    let data = JSON.parse(text);
                    // only reuse the cache if it was built for the project we have open now
                    if (data != null && data.projectPath === GMF.projectPath && data.rooms != null) {
                        for (let name in data.rooms) {
                            let entry = data.rooms[name];
                            if (entry != null && entry.url != null) {
                                thumbnailCache[name] = entry.url;
                                thumbnailHashes[name] = entry.hash;
                            }
                        }
                    }
                } catch (e) {
                    console.error("couldn't parse thumbnail cache", e);
                }
                thumbCacheLoaded = true;
                callback();
            });
        });
    }

    function writeThumbCache() {
        let rooms = {};
        for (let name in thumbnailCache) {
            rooms[name] = { url: thumbnailCache[name], hash: thumbnailHashes[name] };
        }
        Engine.fileWriteText(THUMB_CACHE_FILE, JSON.stringify({
            projectPath: GMF.projectPath,
            rooms: rooms
        }));
    }

    // debounced
    function scheduleSaveThumbCache() {
        if (saveTimer != null) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { saveTimer = null; writeThumbCache(); }, 1500);
    }

    function flushThumbCache() {
        if (saveTimer == null) return;
        clearTimeout(saveTimer);
        saveTimer = null;
        writeThumbCache();
    }

    // drop a room's cached thumbnail so it regenerates
    RoomPicker.invalidateThumbnail = function(room) {
        if (thumbnailCache[room] != null || thumbnailHashes[room] != null) {
            delete thumbnailCache[room];
            delete thumbnailHashes[room];
            delete verified[room];
            scheduleSaveThumbCache();
        }
    };

    // Re-render a room's thumbnail rgiht now from in-memory data (used after an in-editor save) so the preview updates live
    RoomPicker.updateThumbnail = function(room, roomData) {
        let hash = roomHash(roomData);
        RoomThumbnail.render(roomData, 128, (url) => {
            if (url == null) return;
            thumbnailCache[room] = url;
            thumbnailHashes[room] = hash;
            verified[room] = true;
            scheduleSaveThumbCache();
            for (let img of document.querySelectorAll("#roompickerlist .roomthumb")) {
                if (img.dataset.room === room) { img.src = url; break; }
            }
        });
    };

    window.addEventListener("beforeunload", flushThumbCache);

    // Coming back to the app (alt-tabbing back from GameMaker) re-arms the hash check
    window.addEventListener("focus", () => {
        if (!open) return;
        verified = {};
        if (thumbObserver != null) { thumbObserver.disconnect(); thumbObserver = null; }
        thumbQueue = [];
        let observer = getThumbObserver();
        for (let img of document.querySelectorAll("#roompickerlist .roomthumb")) {
            observer.observe(img);
        }
    });

    function openWindow() {
        if (open) return;
        open = true;
        Settings.saveWindowOpen("roompicker", true);

        let size = Settings.getWindowSize("roompicker", 50, 50, 200, 500);
        winbox = new WinBox("Room Picker", {
            mount: document.querySelector("div.wb#roompicker"),
            onclose: () => {
                open = false;
                Settings.saveWindowOpen("roompicker", false);
                flushThumbCache();
            },
            x:size.x,
            y:size.y,
            width:size.w,
            height:size.h,
            onresize: (w, h) => {
                Settings.saveWindowWH("roompicker", w, h)
            },
            onmove: (x, y) => {
                Settings.saveWindowXY("roompicker", x, y)
            }
        });
        
        // refresh the object list
        let roomPicker = document.querySelector("#roompickerlist");
        roomPicker.innerHTML = "";

        // load the on-disk cache first so cached thumbnails show instantly without re-rendering
        ensureThumbCacheLoaded(() => {
            GMF.listRooms((rooms) => {
                cachedRooms = rooms;
                buildList(rooms, document.querySelector("#roompickerfilter").value);
            });
        });
    }
    RoomPicker.openWindow = openWindow;

    function buildList(rooms, filter) {
        let roomPicker = document.querySelector("#roompickerlist");
        roomPicker.innerHTML = "";

        // tear down the old list, drop any pending thumbnail work for it
        if (thumbObserver != null) { thumbObserver.disconnect(); thumbObserver = null; }
        thumbQueue = [];

        for (let i = 0; i < rooms.length; i++)
        {
            if (rooms[i].indexOf(filter) == -1) continue;

            let option = document.createElement("div");

            option.className = "listOption";
            option.type = "radio";
            option.name = "roomPickerRoom";
            option.value = rooms[i];
            option.id = rooms[i];
            option.innerText = rooms[i];
            option.onclick = () => {
                setHighlight(rooms[i]);
            }

            attachThumbnail(option, rooms[i]);

            roomPicker.appendChild(option);
        }
    }

    function attachThumbnail(option, room) {
        let img = document.createElement("img");
        img.className = "roomthumb";
        img.dataset.room = room;
        option.insertBefore(img, option.firstChild);

        // show the cached thumbnail instantly if we have one...
        if (thumbnailCache[room] != null) {
            img.src = thumbnailCache[room];
        }
        // ...but still observe it: once it scrolls into view we hash-check the room file
        // (to catch edits made in GameMaker) and regenerate if it's missing or stale.
        getThumbObserver().observe(img);
    }

    function getThumbObserver() {
        if (thumbObserver != null) return thumbObserver;
        thumbObserver = new IntersectionObserver((entries) => {
            for (let entry of entries) {
                if (!entry.isIntersecting) continue;
                let img = entry.target;
                thumbObserver.unobserve(img);
                enqueueThumb(img, img.dataset.room);
            }
        }, { root: document.querySelector("#roompickerlist"), rootMargin: "128px" });
        return thumbObserver;
    }

    function enqueueThumb(img, room) {
        // already hash-checked this session - just make sure the cached image is shown
        if (verified[room]) {
            if (thumbnailCache[room] != null) img.src = thumbnailCache[room];
            return;
        }
        thumbQueue.push({ img: img, room: room });
        pumpThumbs();
    }

    function pumpThumbs() {
        while (activeThumbs < MAX_CONCURRENT_THUMBS && thumbQueue.length > 0) {
            let job = thumbQueue.shift();
            activeThumbs += 1;
            generateThumb(job.img, job.room);
        }
    }

    function generateThumb(img, room) {
        let finished = false;
        let finishOne = () => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            activeThumbs -= 1;
            pumpThumbs();
        };
        // timeout in case of file reads or renders that never call back
        let timer = setTimeout(finishOne, 10000);

        try {
            // getRoomData reads the .yy fresh from disk, so this picks up GameMaker edits
            GMF.getRoomData(room, (data) => {
                try {
                    let hash = roomHash(data);
                    verified[room] = true;

                    // cached thumbnail still matches the file on disk - nothing to do
                    if (thumbnailCache[room] != null && thumbnailHashes[room] === hash) {
                        finishOne();
                        return;
                    }

                    // missing or stale (edited in GameMaker) - (re)render
                    vlog("regenerating thumbnail: " + room);
                    RoomThumbnail.render(data, 128, (url) => {
                        if (url != null) {
                            thumbnailCache[room] = url;
                            thumbnailHashes[room] = hash;
                            scheduleSaveThumbCache();
                            if (img.isConnected) img.src = url;
                        }
                        finishOne();
                    });
                } catch (e) {
                    console.error("thumbnail render failed for " + room, e);
                    finishOne();
                }
            });
        } catch (e) {
            console.error("thumbnail load failed for " + room, e);
            finishOne();
        }
    }

    function setHighlight(id) {
        vlog("room picked: " + id);
        let elements = document.querySelectorAll("#roompickerlist .listOption");
        for (var el of elements) {
            el.setAttribute("selected", el.id == id?"true":"false");
        }
    }

    function getSelected() {
        let elements = document.querySelectorAll("#roompickerlist .listOption");
        for (var el of elements) {
            if (el.getAttribute("selected") == "true") return el.id;
        }
    }

    function loadSelectedRoom()
    {
        loadRoom(getSelected());
    }

    function loadRoom(room) 
    {
        log("loading room: "+room);
        Settings.saveValue("lastLoadedRoom", room);
        GMF.getRoomData(room, (data) => {
            console.log(data);
            Room.loadRoom(data);
        });
    }
    RoomPicker.loadRoom = loadRoom;

    document.querySelector("#roompickerfilter").addEventListener("input", () => {
        buildList(cachedRooms, document.querySelector("#roompickerfilter").value);
    })
    document.querySelector("#roompickerlist").addEventListener("dblclick", loadSelectedRoom);
    document.querySelector("#btn_rooms").addEventListener("click", openWindow);
    document.querySelector("#btn_roompickerload").addEventListener("click", loadSelectedRoom);

    window.RoomPicker = RoomPicker;
})();