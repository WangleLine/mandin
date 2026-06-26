(function() {
    let open = false;
    let winbox = null;
    let cachedRooms = null;
    let thumbnailCache = {};
    let thumbQueue = [];
    let activeThumbs = 0;
    let thumbObserver = null;
    const MAX_CONCURRENT_THUMBS = 3;

    let RoomPicker = {};

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

        GMF.listRooms((rooms) => {
            cachedRooms = rooms;
            buildList(rooms, document.querySelector("#roompickerfilter").value);
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

        if (thumbnailCache[room] != null) {
            img.src = thumbnailCache[room];
            return;
        }

        // Only build a thumbnail once the entry actually scrolls into view
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
        if (thumbnailCache[room] != null) { img.src = thumbnailCache[room]; return; }
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
            GMF.getRoomData(room, (data) => {
                try {
                    Room.renderThumbnail(data, 128, (url) => {
                        if (url != null) {
                            thumbnailCache[room] = url;
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