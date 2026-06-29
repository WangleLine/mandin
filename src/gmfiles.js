(function() {
    let GMF = {};

    function yypParse(text)
    {
        // gml json is broken
        text = text.replaceAll(/,\s*}/g, "}");
        text = text.replaceAll(/,\s*\]/g, "]");
        return JSON.parse(text);
    }
    GMF.yypParse = yypParse;

    let textCache = {};
    function cachedTextRead(path, callback)
    {
        if (textCache[path] != null) {
            callback(textCache[path]);
            return;
        }

        Engine.fileReadText(path, (data) => {
            textCache[path] = data;
            callback(data);
        });
    }

    // the .yyp loads asynchronously, let callers wait for it
    let ready = false;
    let readyCallbacks = [];
    function onReady(callback) {
        if (ready) { callback(); return; }
        readyCallbacks.push(callback);
    }
    GMF.onReady = onReady;

    function setProjectPath(_projectPath)
    {
        log("setting project path: "+_projectPath);
        _projectPath = _projectPath.replaceAll("\\", "/");
        GMF.projectPath = _projectPath;

        let lastSlash = GMF.projectPath.lastIndexOf("/");
        let lastBackslash = GMF.projectPath.lastIndexOf("\\");

        GMF.projectDirectory = GMF.projectPath.substring(0, Math.max(lastSlash, lastBackslash)+1);
        log("project directory: "+GMF.projectDirectory);

        Engine.fileReadText(GMF.projectPath, (data) => {
            log("Loaded project data");
            GMF.projectData = yypParse(data);
            ready = true;
            while (readyCallbacks.length > 0) readyCallbacks.shift()();
            console.log(GMF.projectData);
        });
    }
    GMF.setProjectPath = setProjectPath;

    function listRooms(callback) {
        Engine.listFilesInDir(GMF.projectDirectory+"rooms/", (list) => {
            let names = [];
            let sl = (GMF.projectDirectory+"rooms/").length;
            for (let opath of list) {
                names.push(opath.substring(sl));
            }
            callback(names);
        });
    }
    GMF.listRooms = listRooms;

    function listResourceNames(folder, callback) {
        onReady(() => {
            let prefix = folder + "/";
            let names = [];
            for (let r of GMF.projectData.resources) {
                if (r.id != null && typeof r.id.path === "string" && r.id.path.startsWith(prefix)) {
                    names.push(r.id.name);
                }
            }
            names.sort();
            callback(names);
        });
    }
    GMF.listResourceNames = listResourceNames;

    function listObjects(callback) {
        listResourceNames("objects", callback);
    }
    GMF.listObjects = listObjects;

    function getResourcePath(asset) {
        for (let id of GMF.projectData.resources) {
            if (id.id.name == asset) return GMF.projectDirectory + id.id.path;
        }
    }
    GMF.getResourcePath = getResourcePath;

    function getAssetData(asset, callback) {
        let path = getResourcePath(asset);
        if (path == null) {
            console.warn("GMF.getAssetData: '" + asset + "' is not in the project, skipping");
            return;
        }
        cachedTextRead(path, (data) => {
            callback(yypParse(data));
        });
    }
    GMF.getAssetData = getAssetData;

    // like getObjectSprite but for a sprite resource straight up (asset-layer decals use this!)
    function getSprite(sprite, callback) {
        let spritePath = getResourcePath(sprite);
        if (spritePath == null) {
            console.warn("GMF.getSprite: '" + sprite + "' is not in the project, skipping");
            return;
        }
        let dir = spritePath.substring(0, spritePath.lastIndexOf("/") + 1);
        cachedTextRead(spritePath, (data) => {
            data = yypParse(data);
            callback({ data: data, img_path: dir + data.frames[0].name + ".png" });
        });
    }
    GMF.getSprite = getSprite;

    function getObjectSprite(object, callback) {
        getAssetData(object, (data) => {
            if (data.spriteId == null) return;
            let spriteDataPath = GMF.projectDirectory + data.spriteId.path;
            let spriteDirectoryPath = spriteDataPath.substring(0, spriteDataPath.lastIndexOf("/")+1);
            
            cachedTextRead(GMF.projectDirectory + data.spriteId.path, (data) => {
                data = yypParse(data);
                callback({data:data, img_path: spriteDirectoryPath + data.frames[0].name + ".png"});
            });
        });
    }
    GMF.getObjectSprite = getObjectSprite;

    function getRoomData(room, callback) {
        console.log(getRoomDataPath(room));
        Engine.fileReadText(getRoomDataPath(room), (data) => {
            callback(yypParse(data));
        });
    }
    GMF.getRoomData = getRoomData;

    function getRoomDataPath(room) {
        return GMF.projectDirectory + "rooms/" + room + "/" + room + ".yy";
    }
    GMF.getRoomDataPath = getRoomDataPath;

    window.GMF = GMF;
    
})();