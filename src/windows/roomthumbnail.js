(function() {
    let RoomThumbnail = {};

    function rectBounds(x, y, w, h) {
        // normalise so negative width/height (flipped sprites) still give a valid box
        return {
            minX: Math.min(x, x + w),
            minY: Math.min(y, y + h),
            maxX: Math.max(x, x + w),
            maxY: Math.max(y, y + h)
        };
    }

    // Decompresses a tile layer into a draw command + the pixel bounds of its non-empty tiles (so empty rows/columns can be cropped out of the thumbnail)
    function buildTileCommand(layer, tileset_data, tileset_image) {
        let tiles = layer.tiles["TileCompressedData"];
        let serialiseWidth = layer.tiles.SerialiseWidth;
        let tw = tileset_data.tileWidth;
        let th = tileset_data.tileHeight;
        let placements = [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let pos = 0, x = 0, y = 0;
        function place(tile) {
            // tile index 0 (masking off the flip/rotate flags) means empty - skip it
            if ((tile & 262143) !== 0) {
                placements.push({ tile: tile, x: x, y: y });
                if (x * tw < minX) minX = x * tw;
                if (y * th < minY) minY = y * th;
                if ((x + 1) * tw > maxX) maxX = (x + 1) * tw;
                if ((y + 1) * th > maxY) maxY = (y + 1) * th;
            }
            x += 1;
            if (x >= serialiseWidth) { x = 0; y += 1; }
        }
        while (pos < tiles.length) {
            if (tiles[pos] < 0) {
                let rep = tiles[pos] * -1;
                pos += 1;
                for (let n = 0; n < rep; n++) place(tiles[pos]);
                pos += 1;
            } else {
                let rep = tiles[pos];
                pos += 1;
                for (let n = 0; n < rep; n++) { place(tiles[pos]); pos += 1; }
            }
        }
        if (placements.length == 0) return null;
        return {
            bounds: { minX: minX, minY: minY, maxX: maxX, maxY: maxY },
            draw: (ctx) => {
                for (let p of placements) {
                    Util.drawTile(tileset_image, ctx, p.tile, p.x, p.y, tw, th);
                }
            }
        };
    }

    // Renders roomData to a small thumbnail data-URL, cropped to tiles/instances
    function render(roomData, maxSize, callback) {
        if (roomData == null || roomData.roomSettings == null || roomData.layers == null) { callback(null); return; }
        let roomW = roomData.roomSettings.Width;
        let roomH = roomData.roomSettings.Height;
        if (!(roomW > 0) || !(roomH > 0)) { callback(null); return; }

        // draw back-to-front (higher depth = further back)
        let layers = roomData.layers.slice().sort((a, b) => b.depth - a.depth);
        // one ordered command list per layer, filled in as async resources arrive
        let layerCommands = layers.map(() => []);

        let pending = 1;
        let finished = false;
        let timer = null;

        function composite() {
            if (finished) return;
            finished = true;
            clearTimeout(timer);

            // content bounding box from tiles + instances
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let cmds of layerCommands) {
                for (let c of cmds) {
                    if (c == null || c.bounds == null) continue;
                    if (c.bounds.minX < minX) minX = c.bounds.minX;
                    if (c.bounds.minY < minY) minY = c.bounds.minY;
                    if (c.bounds.maxX > maxX) maxX = c.bounds.maxX;
                    if (c.bounds.maxY > maxY) maxY = c.bounds.maxY;
                }
            }

            if (!(maxX > minX) || !(maxY > minY)) {
                // no tile/instance content - fall back to the whole room
                minX = 0; minY = 0; maxX = roomW; maxY = roomH;
            } else {
                // a little breathing room around the content
                let pad = Math.max(maxX - minX, maxY - minY) * 0.04;
                minX -= pad; minY -= pad; maxX += pad; maxY += pad;
            }

            let cropW = maxX - minX;
            let cropH = maxY - minY;
            let scale = Math.min(maxSize / cropW, maxSize / cropH);

            let cnv = document.createElement("canvas");
            cnv.width = Math.max(1, Math.round(cropW * scale));
            cnv.height = Math.max(1, Math.round(cropH * scale));
            let ctx = cnv.getContext("2d");
            ctx.scale(scale, scale);
            ctx.translate(-minX, -minY);

            for (let cmds of layerCommands) {
                for (let c of cmds) {
                    if (c != null) c.draw(ctx);
                }
            }

            callback(cnv.toDataURL());
        }
        function done() {
            pending -= 1;
            if (pending <= 0) composite();
        }
        // safety net for objects without sprites (they dont callback)
        timer = setTimeout(composite, 5000);

        for (let li = 0; li < layers.length; li++) {
            let layer = layers[li];
            let cmds = layerCommands[li];
            if (layer.visible === false) continue;

            if (layer["$GMRBackgroundLayer"] != null && layer.colour != null) {
                let colour = Util.abgrToRGBA(layer.colour);
                // bounds null -> the background fill doesn't expand the content crop
                cmds.push({
                    bounds: null,
                    draw: (ctx) => { ctx.fillStyle = colour; ctx.fillRect(0, 0, roomW, roomH); }
                });
            }

            if (layer["$GMRTileLayer"] != null && layer.tilesetId != null) {
                pending += 1;
                GMF.getAssetData(layer.tilesetId.name, (tileset_data) => {
                    GMF.getObjectSprite(layer.tilesetId.name, (sprite_data) => {
                        Util.loadImage(sprite_data.img_path, (tileset_image) => {
                            let cmd = buildTileCommand(layer, tileset_data, tileset_image);
                            if (cmd != null) cmds.push(cmd);
                            done();
                        });
                    });
                });
            }

            if (layer["$GMRInstanceLayer"] != null) {
                let count = Math.min(layer.instances.length, 500); // don't choke on huge rooms
                for (let k = 0; k < count; k++) {
                    let inst = layer.instances[k];
                    cmds.push(null); // reserve an ordered slot, filled once the sprite loads
                    let slot = cmds.length - 1;
                    pending += 1;
                    GMF.getObjectSprite(inst.objectId.name, (sprite_data) => {
                        Util.loadImage(sprite_data.img_path, (img) => {
                            let dx = inst.x - sprite_data.data.sequence.xorigin;
                            let dy = inst.y - sprite_data.data.sequence.yorigin;
                            let dw = sprite_data.data.width * inst.scaleX;
                            let dh = sprite_data.data.height * inst.scaleY;
                            cmds[slot] = {
                                bounds: rectBounds(dx, dy, dw, dh),
                                draw: (ctx) => { ctx.drawImage(img, dx, dy, dw, dh); }
                            };
                            done();
                        });
                    });
                }
            }
        }

        done(); // release the initial guard
    }
    RoomThumbnail.render = render;

    window.RoomThumbnail = RoomThumbnail;
})();
