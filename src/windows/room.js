(function() {
    let Room = {};
    let open = false;
    let roomData = null;
    let tilesetData = null;
    let tilesetImage = null;
    let brushSize = 1;

    let outputCanvas = null;
    let outctx = null;
    let selectedInstancePreview = null;
    let pendingFit = false; // request a zoom-to-fit once the canvas has a real size

    let rv = document.querySelector("div.wb#roomViewer");

    let roomLayers = [];
    let instances = [];
    let winbox = null;

    Room.getInstances = () => { return instances };

    function drawLayer(ctx, layer) {
        if (layer["$GMRTileLayer"] != null) {
            let tileArraySize = layer.tiles.SerialiseWidth * layer.tiles.SerialiseHeight;
            if (tileArraySize == 0) {
                log("SIZE IS ZERO WHY");
                return;
            }
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            let newTileArray = [layer.tiles.SerialiseWidth * layer.tiles.SerialiseHeight,];
            GMF.getAssetData(layer.tilesetId.name, (tileset_data) => {
                tilesetData = tileset_data;
                GMF.getObjectSprite(layer.tilesetId.name, (sprite_data) => {
                    Util.loadImage(sprite_data.img_path, (tileset_image) => {
                        ctx.canvas.tileset_image = tileset_image;
                        tilesetImage = tileset_image;
                        let tiles = layer.tiles["TileCompressedData"];

                        let pos = 0;
                        let x = 0;
                        let y = 0;
                        while (pos < tiles.length) {
                            if (tiles[pos] < 0) {
                                let rep = tiles[pos] * -1;
                                pos += 1;
                                for (let n = 0; n < rep; n++) {
                                    Util.drawTile(tileset_image, ctx, tiles[pos], x, y, tileset_data.tileWidth, tileset_data.tileHeight);
                                    newTileArray.push(tiles[pos]);
                                    x += 1;
                                    if (x >= layer.tiles.SerialiseWidth) {
                                        x = 0;
                                        y += 1;
                                    }
                                }
                                pos += 1;
                            } else {
                                let rep = tiles[pos];
                                pos += 1;
                                for (let n = 0; n < rep; n++) {
                                    Util.drawTile(tileset_image, ctx, tiles[pos], x, y, tileset_data.tileWidth, tileset_data.tileHeight);
                                    newTileArray.push(tiles[pos]);
                                    pos += 1;
                                    x += 1;
                                    if (x >= layer.tiles.SerialiseWidth) {
                                        x = 0;
                                        y += 1;
                                    }
                                }
                            }
                        }
                        layer.tiles["TileCompressedData"] = newTileArray;
                    })
                });
            });
        }

        if (layer["$GMRInstanceLayer"] != null) {
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            for (let inst of layer.instances) {
                GMF.getObjectSprite(inst.objectId.name, (sprite_data) => {
                    Util.loadImage(sprite_data.img_path, (img) => {
                        Util.drawInstance(ctx, img, sprite_data.data, inst);
                    })
                });
            }
        }

        // asset layers aka the decalsssss
        if (layer["$GMRAssetLayer"] != null) {
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            for (let asset of layer.assets) {
                if (asset["$GMRSpriteGraphic"] == null || asset.spriteId == null) continue;
                GMF.getSprite(asset.spriteId.name, (sprite_data) => {
                    Util.loadImage(sprite_data.img_path, (img) => {
                        Util.drawInstance(ctx, img, sprite_data.data, asset);
                    })
                });
            }
        }

        if (layer["$GMRBackgroundLayer"] != null) {
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.fillStyle = Util.abgrToRGBA(layer.colour);
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        }
    }

    function reRenderCurrentLayer() {
        for (let i = 0; i < roomLayers.length; i++) {
            if (roomLayers[i].layer == Layers.currentLayer) {
                drawLayer(roomLayers[i].getContext("2d"), Layers.currentLayer);
            }
        }
    }

    function reRenderLayers() {
        for (let i = 0; i < roomLayers.length; i++) {
            drawLayer(roomLayers[i].getContext("2d"), roomLayers[i].layer);
        }
    }

    function loadRoom(_roomData) {
        let lastTransform = null;
        if (outctx != null) {
            lastTransform = outctx.getTransform();
        }
        // only keep the current view when reloading the same room, otherwise do zoomerrr
        let sameRoom = roomData != null && roomData["%Name"] === _roomData["%Name"];
        Layers.buildList(_roomData);

        roomData = _roomData;
        let layers = roomData.layers;
        
        let width = roomData.roomSettings.Width;
        let height = roomData.roomSettings.Height;

        rv.innerHTML = "";
        roomLayers = [];
        for (let i = 0; i < layers.length; i++)
        {
            let cnv = document.createElement("canvas");
            cnv.width = width;
            cnv.height = height;
            let _ctx = cnv.getContext("2d");
            _ctx.imageSmoothingEnabled = false;
            drawLayer(_ctx, layers[i]);
            cnv.style.position = "absolute";
            cnv.style.width = (width).toString()+"px";
            cnv.layer = layers[i];
            roomLayers.push(cnv);
        }
        
        roomLayers.sort((a, b) => b.layer.depth - a.layer.depth);
        
        if (outputCanvas == null) {
            outputCanvas = document.createElement("canvas");
            outctx = outputCanvas.getContext("2d");
        }
        rv.appendChild(outputCanvas);
        outputCanvas.width = outputCanvas.parentElement.clientWidth;
        outputCanvas.height = outputCanvas.parentElement.clientHeight;
        outctx.imageSmoothingEnabled = false;
        
        render();

        openWindow();
        // Preserve any existing onresize handler (which saves window size)
        const _prevWinboxOnResize = winbox.onresize;
        winbox.onresize = (w, h) => {
            if (typeof _prevWinboxOnResize === 'function') {
                try { _prevWinboxOnResize(w, h); } catch (e) { /* ignore */ }
            }
            // Update the internal canvas size to match the new window client area
            outputCanvas.width = outputCanvas.parentElement.clientWidth;
            outputCanvas.height = outputCanvas.parentElement.clientHeight;
            outctx.imageSmoothingEnabled = false;
        }
        if (lastTransform != null && sameRoom) {
            outctx.setTransform(lastTransform);
            pendingFit = false;
        } else {
            // zoom so the room almsot fills the view
            pendingFit = true;
            fitRoomToView();
        }

        onLayerSwitch();
        setMaxUniqueIndex();
        document.querySelector("#btn_roomreload").addEventListener("click", reload);
    }
    Room.loadRoom = loadRoom;

    // center the room and scale it so it aaaalmost fills the view
    function fitRoomToView() {
        if (roomLayers.length == 0) return;
        let roomW = roomLayers[0].width;
        let roomH = roomLayers[0].height;
        if (!(roomW > 0) || !(roomH > 0)) return;
        if (!(outputCanvas.width > 0) || !(outputCanvas.height > 0)) return; // size not ready yet
        let scale = Math.min(outputCanvas.width / roomW, outputCanvas.height / roomH) * 0.95;
        outctx.setTransform(scale, 0, 0, scale,
            (outputCanvas.width - roomW * scale) / 2,
            (outputCanvas.height - roomH * scale) / 2);
    }

    function render() {
        if (outputCanvas.width == 0) {
            outputCanvas.width = outputCanvas.parentElement.clientWidth;
            outputCanvas.height = outputCanvas.parentElement.clientHeight;
            outctx.imageSmoothingEnabled = false;
            moveView((outputCanvas.width - roomLayers[0].width)/2, (outputCanvas.height - roomLayers[0].height)/2);
        }

        // apply  zoom once the canvas finally has a real size
        if (pendingFit && outputCanvas.width > 0) {
            fitRoomToView();
            pendingFit = false;
        }

        let t = outctx.getTransform();
        outctx.resetTransform();
        outctx.clearRect(0, 0, outctx.canvas.width, outctx.canvas.height);
        outctx.setTransform(t);
        for (let i = 0; i < roomLayers.length; i++)
        {
            if (roomLayers[i].layer.visible) {
                outctx.drawImage(roomLayers[i], 0, 0);
            }
        }

        // outline around the room bounds (save/restore so lineWidth/strokeStyle don't leak into the overlays below)
        if (roomData != null && roomData.roomSettings != null) {
            let rw = roomData.roomSettings.Width;
            let rh = roomData.roomSettings.Height;
            outctx.save();
            outctx.strokeStyle = "#ffffff40";
            outctx.lineWidth = 1 / outctx.getTransform().a; // keep it 1px ish even if zoomy
            outctx.strokeRect(0, 0, rw, rh);
            outctx.restore();
        }

        if (Layers.onTileLayer() && tilesetData != null && tilesetImage != null) {
            let off = Math.floor(brushSize/2);
            for (let i = 0; i < brushSize; i++) {
                for (let j = 0; j < brushSize; j++) {
                    Util.drawTile(tilesetImage, outctx, TilePicker.getCurrentTile(mouseTile.x + mouseTile.y * (j+2) * (i+2)), -off + mouseTile.x + i, -off + mouseTile.y + j, tilesetData.tileWidth, tilesetData.tileHeight);
                }
            }
        }

        if (Layers.onInstanceLayer()) {
            if (instanceHighlight != null) {
                outctx.strokeStyle = "#00ff00aa";
                let a = -beep + hrect.x + 0.5 - 1;
                let b = - beep + hrect.y + 0.5 - 1;
                let c = 1 + a + (hrect.w + beep*2);
                let d = 1 + b + (hrect.h + beep*2);
                funRect(a,b,c,d);
            }

            for (let i = 0; i < instanceSelection.length; i++) {
                let inst = instanceSelection[i];
                let x1 = 0.5 + inst.instanceData.x - inst.spriteData.sequence.xorigin;
                let y1 = 0.5 + inst.instanceData.y - inst.spriteData.sequence.yorigin;
                let x2 = -1 + x1 + inst.spriteData.width * inst.instanceData.scaleX;
                let y2 = -1 + y1 + inst.spriteData.height * inst.instanceData.scaleY;
                outctx.strokeStyle = "#ffbb00dd";
                funRect(x1, y1, x2, y2);
            }

            if (boxSelectStart != null) {
                outctx.strokeStyle = "#ffffffdd";
                let mx1 = Math.min(boxSelectStart.x, mouseRoom.x);
                let mx2 = Math.max(boxSelectStart.x, mouseRoom.x);
                let my1 = Math.min(boxSelectStart.y, mouseRoom.y);
                let my2 = Math.max(boxSelectStart.y, mouseRoom.y);
                funRect(mx1, my1, mx2, my2);

                for (let inst of instances)
                {
                    let x1 = inst.instanceData.x - inst.spriteData.sequence.xorigin;
                    let y1 = inst.instanceData.y - inst.spriteData.sequence.yorigin;
                    let x2 = x1 + inst.spriteData.width * inst.instanceData.scaleX;
                    let y2 = y1 + inst.spriteData.height * inst.instanceData.scaleY;

                    if (mx1 < x2 && my1 < y2 && mx2 > x1 && my2 > y1) {
                        outctx.strokeStyle = "#9922FFdd";
                        funRect(x1, y1, x2, y2);
                    }
                }
            }

            if (selectedInstancePreview != null && holdingAltToPreviewInstancePlacement) {
                outctx.drawImage(
                    selectedInstancePreview.img, 
                    mouseTile.x - selectedInstancePreview.data.data.sequence.xorigin, 
                    mouseTile.y - selectedInstancePreview.data.data.sequence.yorigin,
                    selectedInstancePreview.data.data.width,
                    selectedInstancePreview.data.data.height
                );
            }
        }

        requestAnimationFrame(render);
    }
    Room.render = render;
    let instanceSelection = [];

    function funRect(x1, y1, x2, y2) {
        outctx.beginPath();

        outctx.moveTo(x1, y1 + 2.5);
        outctx.lineTo(x1, y1);
        outctx.lineTo(x1 + 2.5, y1);

        outctx.moveTo(x2, y1 + 2.5);
        outctx.lineTo(x2, y1);
        outctx.lineTo(x2 - 2.5, y1);

        outctx.moveTo(x1, y2 - 2.5);
        outctx.lineTo(x1, y2);
        outctx.lineTo(x1 + 2.5, y2);

        outctx.moveTo(x2, y2 - 2.5);
        outctx.lineTo(x2, y2);
        outctx.lineTo(x2 - 2.5, y2);

        outctx.stroke();
    }

    function reload() {
        let transform = outctx.getTransform();
        GMF.getRoomData(roomData["%Name"], (data) => {
            Layers.buildList(data);
            Room.loadRoom(data);
            outctx.setTransform(transform);
        });
    }

    function updateVisibility() {
        for (let i = 0; i < roomLayers.length; i++) {
            roomLayers[i].style.visibility = roomLayers[i].layer.visible?"visible":"hidden";
        }
    }
    Room.updateVisibility = updateVisibility;

    function openWindow() {
        if (open) return;
        open = true;
        let size = Settings.getWindowSize("room", 10, 10, 400, 300);
        winbox = new WinBox("Room Editor", {
            mount: document.querySelector("div.wb#roomEditor"),
            onclose: () => {
                open = false;
                Settings.saveWindowXYWH("room", winbox.x, winbox.y, winbox.width, winbox.height);
            },
            x:size.x,
            y:size.y,
            width:size.w,
            height:size.h,
            bottom:"2px",
            onresize: (w, h) => {
                Settings.saveWindowWH("room", w, h)
            },
            onmove: (x, y) => {
                Settings.saveWindowXY("room", x, y)
            }
        });
    }

    let dragging = false;
    let painting = false;
    let instancing = false;
    let deleting = false;
    let holdingAltToPreviewInstancePlacement = false;
    let boxSelectStart = null;
    rv.addEventListener("mousedown", (e) => {
        if (e.button == 1) {
            dragging = true;
        }

        if (e.button == 0) {
            if (Layers.onTileLayer()) {
                painting = true;
                Undo.beginSubstack();
                let off = Math.floor(brushSize/2);
                for (let i = 0; i < brushSize; i++) {
                    for (let j = 0; j < brushSize; j++) {
                        let newTile = TilePicker.getCurrentTile();
                        let x = -off+mouseTile.x+i;
                        let y = -off+mouseTile.y+j;
                        let oldTile = getTile(x, y);
                        Undo.registerAction("Draw a tile", () => {
                            paintTile(x, y, newTile);
                        }, () => {
                            paintTile(x, y, oldTile);
                        }, true);
                    }
                }
            }

            if (Layers.onInstanceLayer()) {
                if (e.altKey) {
                    instancingUndo = beginDataUndo();
                    newInstance(ObjectPicker.getSelectedObject(), Layers.currentLayer, mouseTile.x, mouseTile.y);
                    reRenderCurrentLayer();
                    onLayerSwitch();
                    instancing = true;
                } else {
                    if (!e.shiftKey) instanceSelection = [];
                    if (instanceHighlight != null) {
                        if (instanceSelection.indexOf(instanceHighlight) == -1) {
                            instanceSelection.push(instanceHighlight);
                        }
                    } else {
                        boxSelectStart = {
                            x: mouseRoom.x,
                            y: mouseRoom.y
                        };
                    }
                }
            }
        }

        if (e.button == 2) {
            deleting = true;
            if (Layers.onTileLayer()) {
                Undo.beginSubstack();
                let off = Math.floor(brushSize/2);
                for (let i = 0; i < brushSize; i++) {
                    for (let j = 0; j < brushSize; j++) {
                        let x = -off+mouseTile.x+i;
                        let y = -off+mouseTile.y+j;
                        let oldTile = getTile(x, y);
                        Undo.registerAction("Draw a tile", () => {
                            deleteTile(x, y);
                        }, () => {
                            paintTile(x, y, oldTile);
                        });
                    }
                }
            }
        }
    });

    function tileInBounds(x, y) {
        if (x < 0 || x >= Layers.currentLayer.tiles.SerialiseWidth) return false;
        if (y < 0 || y >= Layers.currentLayer.tiles.SerialiseHeight) return false;
        return true;
    }

    function getTile(x, y) {
        // make sure OOB reads don't wrap onto different rows
        if (!tileInBounds(x, y)) return 0;
        return Layers.currentLayer.tiles["TileCompressedData"][1 + x + y * Layers.currentLayer.tiles.SerialiseWidth];
    }

    let lastdrawpos = {x:-1, y:-1};
    function paintTile(x, y, tile) {
        if (!tileInBounds(x, y)) return;
        let index = x + y * Layers.currentLayer.tiles.SerialiseWidth;
        index += 1;
        Layers.currentLayer.tiles["TileCompressedData"][index] = tile;
        
        for (let i = 0; i < roomLayers.length; i++) {
            if (roomLayers[i].layer == Layers.currentLayer) {
                roomLayers[i].getContext("2d").clearRect(x * tilesetData.tileWidth, y * tilesetData.tileHeight, tilesetData.tileWidth, tilesetData.tileHeight);
                Util.drawTile(roomLayers[i].tileset_image, roomLayers[i].getContext("2d"), tile, x, y, tilesetData.tileWidth, tilesetData.tileHeight);
                break;
            }
        }
    }

    function deleteTile(x, y) {
        if (!tileInBounds(x, y)) return;
        let index = x + y * Layers.currentLayer.tiles.SerialiseWidth;
        index += 1;
        Layers.currentLayer.tiles["TileCompressedData"][index] = 0;
        for (let i = 0; i < roomLayers.length; i++) {
            if (roomLayers[i].layer == Layers.currentLayer) {
                roomLayers[i].getContext("2d").clearRect(x * tilesetData.tileWidth, y * tilesetData.tileHeight, tilesetData.tileWidth, tilesetData.tileHeight);
                break;
            }
        }
    }

    function onLayerSwitch() {
        instances = [];
        if (Layers.onInstanceLayer()) {
            for (let inst of Layers.currentLayer.instances) {
                GMF.getObjectSprite(inst.objectId.name, (sprite_data) => {
                    instances.push({
                        instanceData: inst,
                        spriteData: sprite_data.data
                    });
                });
            }
        }
    }
    Room.onLayerSwitch = onLayerSwitch;

    function setObjectPreview(img, sprite_data) {
        selectedInstancePreview = { img:img, data:sprite_data };
    }
    Room.setObjectPreview = setObjectPreview;

    window.addEventListener("keydown", (e) => {
        if(e.ctrlKey && e.key == "s") {
            log("Saving room!");
            let path = GMF.getRoomDataPath(roomData["%Name"]);
            Engine.fileWriteText(path, JSON.stringify(roomData));
            // refresh this room's cached thumbnail from what we just saved
            if (window.RoomPicker != null && RoomPicker.updateThumbnail != null) {
                RoomPicker.updateThumbnail(roomData["%Name"], roomData);
            }
        }

        if (e.key == "]") {
            brushSize += 1;
        }

        if (e.key == "[") {
            if (brushSize > 1) brushSize -= 1;
        }

        if (Layers.onInstanceLayer() && instanceSelection.length > 0) {
            if (e.key == "Delete") {
                let oldData = beginDataUndo();
                for (let inst of instanceSelection) {
                    let removeIndex = Layers.currentLayer.instances.indexOf(inst.instanceData);
                    
                    let removed = Layers.currentLayer.instances.splice(removeIndex, 1)[0];

                    let creationIndex = -1;
                    for (let i = 0; i < roomData.instanceCreationOrder.length; i++) {
                        if (roomData.instanceCreationOrder[i].name == removed.name) {
                            creationIndex = i;
                            break;
                        }
                    }
                    if (creationIndex != -1) roomData.instanceCreationOrder.splice(creationIndex, 1);
                }
                instanceSelection = [];
                reRenderCurrentLayer();
                onLayerSwitch();
                registerDataUndo("Delete instances (dataundo)", oldData);
            }

            if (e.key == "ArrowLeft") { moveSelectedInstances(-Layers.currentLayer.gridX, 0); }
            if (e.key == "ArrowRight") { moveSelectedInstances(Layers.currentLayer.gridX, 0); }
            if (e.key == "ArrowUp") { moveSelectedInstances(0, -Layers.currentLayer.gridY); }
            if (e.key == "ArrowDown") { moveSelectedInstances(0, Layers.currentLayer.gridY); }
        }

        // kinda hacky fix for windows grabbing focus for the window menu on just hitting alt
        if (e.key == "Alt") e.preventDefault();

        if (Layers.onInstanceLayer() && e.key == "Alt") {
            holdingAltToPreviewInstancePlacement = true;
        }
    })

    window.addEventListener("keyup", (e) => {
        if (e.key == "Alt") {
            e.preventDefault();
            holdingAltToPreviewInstancePlacement = false;
        }
    });

    function moveSelectedInstances(dx, dy)
    {
        for (let inst of instanceSelection) {
            let oldX = inst.instanceData.x;
            let oldY = inst.instanceData.y;
            let newX = inst.instanceData.x + dx;
            let newY = inst.instanceData.y + dy;
            Undo.registerAction("move instances left", () => {
                inst.instanceData.x = newX;
                inst.instanceData.y = newY;
                reRenderCurrentLayer();
            },() => {
                inst.instanceData.x = oldX;
                inst.instanceData.y = oldY;
                reRenderLayers();
            });
        }
    }

    let uniqueIndex = 0;
    function getUniqueName() {
        let output = "mandin_" + uniqueIndex.toString(16);
        uniqueIndex += 1;
        return output;
    }

    function setMaxUniqueIndex() {
        for (let i = 0; i < roomData.instanceCreationOrder.length; i++)
        {
            if (roomData.instanceCreationOrder[i].name.startsWith("mandin_")) {
                let index = parseInt(roomData.instanceCreationOrder[i].name.split("_")[1], 16);
                uniqueIndex = Math.max(uniqueIndex, index);
            }
        }
    }

    function newInstance(object, layer, x, y)
    {
        let instanceName = getUniqueName();
        let output = 
        {
            "$GMRInstance": "v1",
            "%Name": instanceName,
            "colour": 4294967295,
            "frozen": false,
            "hasCreationCode": false,
            "ignore": false,
            "imageIndex": 0,
            "imageSpeed": 1,
            "inheritCode": false,
            "inheritedItemId": null,
            "inheritItemSettings": false,
            "isDnd": false,
            "name": instanceName,
            "objectId": {
              "name": object,
              "path": `objects/${object}/${object}.yy`
            },
            "properties": [],
            "resourceType": "GMRInstance",
            "resourceVersion": "2.0",
            "rotation": 0,
            "scaleX": 1,
            "scaleY": 1,
            "x": x,
            "y": y
        };
        layer.instances.push(output);
        roomData.instanceCreationOrder.push({
            name: instanceName,
            path: `rooms/${roomData.name}/${roomData.name}.yy`
        });
        
    }

    window.addEventListener("mouseup", (e) => {
        if (e.button == 1) {
            dragging = false;
        }

        if (e.button == 0) {
            if (painting) {
                Undo.compressSubstack("painting lots of tiles");
            }
            painting = false;

            if (instancing) {
                registerDataUndo("create instances", instancingUndo);
            }
            instancing = false;

            if (boxSelectStart != null) {
                if (!e.shiftKey) instanceSelection = [];
                for (let inst of instances)
                {
                    let x1 = inst.instanceData.x - inst.spriteData.sequence.xorigin;
                    let y1 = inst.instanceData.y - inst.spriteData.sequence.yorigin;
                    let x2 = x1 + inst.spriteData.width * inst.instanceData.scaleX;
                    let y2 = y1 + inst.spriteData.height * inst.instanceData.scaleY;

                    let mx1 = Math.min(boxSelectStart.x, mouseRoom.x);
                    let mx2 = Math.max(boxSelectStart.x, mouseRoom.x);
                    let my1 = Math.min(boxSelectStart.y, mouseRoom.y);
                    let my2 = Math.max(boxSelectStart.y, mouseRoom.y);

                    if (mx1 < x2 && my1 < y2 && mx2 > x1 && my2 > y1) {
                        instanceSelection.push(inst);
                    }
                }

                boxSelectStart = null;
                instanceHighlight = null;
            }
        }

        if (e.button == 2) {
            if (deleting) {
                Undo.compressSubstack("deleting lots of tiles");
            }
            deleting = false;
        }
    });

    function moveView(x, y) {
        let transform = outctx.getTransform();
        outctx.translate(x / transform.a, y / transform.d);
    }

    let instancingUndo = null;

    window.addEventListener("mousemove", (e) => {
        if (dragging) {
            moveView(e.movementX, e.movementY);
        }

        if (painting && Layers.onTileLayer()) {
            if (mouseTile.x != lastdrawpos.x || mouseTile.y != lastdrawpos.y) {
                lastdrawpos.x = mouseTile.x;
                lastdrawpos.y = mouseTile.y;

                let off = Math.floor(brushSize/2);
                for (let i = 0; i < brushSize; i++) {
                    for (let j = 0; j < brushSize; j++) {
                        let newTile = TilePicker.getCurrentTile();
                        let x = -off+mouseTile.x+i;
                        let y = -off+mouseTile.y+j;
                        let oldTile = getTile(x, y);
                        Undo.registerAction("Draw a tile", () => {
                            paintTile(x, y, newTile);
                        }, () => {
                            paintTile(x, y, oldTile);
                        });
                    }
                }
            }
        }

        if (deleting && Layers != null && Layers.onTileLayer()) {
            if (mouseTile.x != lastdrawpos.x || mouseTile.y != lastdrawpos.y) {
                lastdrawpos.x = mouseTile.x;
                lastdrawpos.y = mouseTile.y;

                let off = Math.floor(brushSize/2);
                for (let i = 0; i < brushSize; i++) {
                    for (let j = 0; j < brushSize; j++) {
                        let x = -off+mouseTile.x+i;
                        let y = -off+mouseTile.y+j;
                        let oldTile = getTile(x, y);
                        Undo.registerAction("Draw a tile", () => {
                            deleteTile(x, y);
                        }, () => {
                            paintTile(x, y, oldTile);
                        });
                    }
                }
            }
        }

        if (Layers.onInstanceLayer()) {
            
            instanceHighlight = null;
            if (e.altKey) {
                if (instancing && (lastdrawpos.x != mouseTile.x || lastdrawpos.y != mouseTile.y))
                {
                    lastdrawpos.x = mouseTile.x;
                    lastdrawpos.y = mouseTile.y;
                    newInstance(ObjectPicker.getSelectedObject(), Layers.currentLayer, mouseTile.x, mouseTile.y);
                    reRenderCurrentLayer();
                    onLayerSwitch();
                }
            } else {
                highlightRect(0,0,0,0);
                for (let inst of instances) {
                    let x1 = inst.instanceData.x - inst.spriteData.sequence.xorigin;
                    let y1 = inst.instanceData.y - inst.spriteData.sequence.yorigin;
                    let x2 = x1 + inst.spriteData.width * inst.instanceData.scaleX;
                    let y2 = y1 + inst.spriteData.height * inst.instanceData.scaleY;
                    if (mouseRoom.x >= x1 && mouseRoom.y >= y1 && mouseRoom.x < x2 && mouseRoom.y < y2) {
                        highlightRect(x1, y1, x2, y2);
                        instanceHighlight = inst;
                    }
                }
    
                if (instanceHighlight != lastInstanceHighlight) {
                    beep = 1;
                    setTimeout(() => {beep = 0;}, 30);
                    lastInstanceHighlight = instanceHighlight;
                }
            }

        }
    });
    let instanceHighlight = null;
    let lastInstanceHighlight = null;
    let beep = 1;

    let hrect = {x:0, y:0, w:0,h:0};
    function highlightRect(x1, y1, x2, y2) 
    {
        hrect.x = x1;
        hrect.y = y1;
        hrect.w = x2-x1;
        hrect.h = y2-y1;
    }

    let mouseRoom = {x:0, y:0};
    let mouseTile = {x:0, y:0};
    rv.addEventListener("mousemove", (e) => {
        let t = outctx.getTransform().inverse();
        mouseRoom = t.transformPoint({x: e.offsetX, y:e.offsetY});

        if (Layers.onTileLayer() && tilesetData != null) {
            mouseTile.x = Math.floor(mouseRoom.x / tilesetData.tileWidth);
            mouseTile.y = Math.floor(mouseRoom.y / tilesetData.tileHeight);
        }

        if (Layers.onInstanceLayer()) {
            mouseTile.x = Math.floor(mouseRoom.x / Layers.currentLayer.gridX) * Layers.currentLayer.gridX;
            mouseTile.y = Math.floor(mouseRoom.y / Layers.currentLayer.gridY) * Layers.currentLayer.gridY;
        }
    });

    rv.addEventListener("wheel", (e) => {
        if (e.ctrlKey) {
            if (e.deltaY > 0 && brushSize > 1) brushSize -= 1;
            if (e.deltaY < 0) brushSize += 1;
        } else {
            let scaleFactor = 1;
            if (e.deltaY < 0) scaleFactor = 1.2;
            if (e.deltaY > 0) scaleFactor = 1/1.2;
            outctx.translate(mouseRoom.x, mouseRoom.y);
            outctx.scale(scaleFactor, scaleFactor);
            outctx.translate(-mouseRoom.x, -mouseRoom.y);
        }
    });

    // expensive and should be phased out
    function beginDataUndo()
    {
        return JSON.stringify(roomData);
    }

    function registerDataUndo(name, _oldData)
    {
        let oldData = _oldData;
        let newData = JSON.stringify(roomData);
        Undo.registerAction(name, () => {
            roomData = JSON.parse(newData);
            reRenderLayers();
        }, function() {
            roomData = JSON.parse(oldData);
            loadRoom(roomData);
        }, false);
    }

    window.Room = Room;
})();