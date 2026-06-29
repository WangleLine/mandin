(function() {
    let Util = {};

    let imageCache = {};

    Util.loadImage = function(path, callback, forceload=false) {
        if (forceload == false && imageCache[path] != null) {
            callback(imageCache[path]);
            return;
        }

        Engine.fileReadBytes(path, (data) => {
            let image = new Image();
            image.src = "data:image/png;base64,"+data;
            image.addEventListener("load", () => {
                imageCache[path] = image;
                callback(image);
            });
        });
    }

    Util.img = function(src) {
        let newImage = document.createElement("img");
        newImage.src = src;
        return newImage;
    }

    // draws a single tile (by index) from a tileset image at tile-grid
    Util.drawTile = function(src, dest, index, x, y, tileWidth, tileHeight) {
        index &= 262143; // mask off the flip/mirror/rotate flags
        let perRow = src.naturalWidth / tileWidth;
        let ix = index % perRow;
        let iy = Math.floor(index / perRow);
        dest.drawImage(src, ix * tileWidth, iy * tileHeight, tileWidth, tileHeight, x * tileWidth, y * tileHeight, tileWidth, tileHeight);
    }

    // alpha from a GM instance's ABGR colour
    Util.instanceAlpha = function(inst) {
        return inst.colour != null ? ((inst.colour >>> 24) & 0xFF) / 255 : 1;
    }

    // draws one little slice region
  // mode 0=stretch, 1=repeat, 2=mirror, 3=blank-repeat, 4=hide
    function nineSliceRegion(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh, mode) {
        if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
        if (mode === 0) { ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh); return; } // stretch
        if (mode === 3 || mode === 4) return; // blank-repeat / hide -> draw nothin
        // repeat (1) or mirror (2): tile the source at native size, clipped to the region.
        // mirror flips every other tile so the seams line up nicelyyy
        let mirror = mode === 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(dx, dy, dw, dh);
        ctx.clip();
        let row = 0;
        for (let ty = 0; ty < dh; ty += sh, row++) {
            let col = 0;
            for (let tx = 0; tx < dw; tx += sw, col++) {
                let fx = (mirror && col % 2 === 1) ? -1 : 1;
                let fy = (mirror && row % 2 === 1) ? -1 : 1;
                if (fx === 1 && fy === 1) {
                    ctx.drawImage(img, sx, sy, sw, sh, dx + tx, dy + ty, sw, sh);
                } else {
                    ctx.save();
                    ctx.translate(dx + tx + (fx < 0 ? sw : 0), dy + ty + (fy < 0 ? sh : 0));
                    ctx.scale(fx, fy);
                    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
                    ctx.restore();
                }
            }
        }
        ctx.restore();
    }

    // GM nine-slice :3
     // fill the dx,dy,W,H rect, keep the corners crisp at native size,
    // stretch/tile the edges + center per the sprite's tileMode (left,top,right,bottom,centre)
    function drawNineSlice(ctx, img, ns, w, h, dx, dy, W, H) {
        let L = Math.max(0, Math.min(ns.left, w));
        let R = Math.max(0, Math.min(ns.right, w - L));
        let T = Math.max(0, Math.min(ns.top, h));
        let B = Math.max(0, Math.min(ns.bottom, h - T));
        let tm = ns.tileMode || [0, 0, 0, 0, 0];
        let scw = w - L - R, sch = h - T - B;                 // source centre size
        let dcw = Math.max(0, W - L - R), dch = Math.max(0, H - T - B); // dest centre size (corners stay native!)

        // the four corners, always drawn 1:1 - no stretchy business
        nineSliceRegion(ctx, img, 0,     0,     L, T, dx,         dy,         L, T, 0);
        nineSliceRegion(ctx, img, w - R, 0,     R, T, dx + W - R, dy,         R, T, 0);
        nineSliceRegion(ctx, img, 0,     h - B, L, B, dx,         dy + H - B, L, B, 0);
        nineSliceRegion(ctx, img, w - R, h - B, R, B, dx + W - R, dy + H - B, R, B, 0);
        // edges
        nineSliceRegion(ctx, img, L,     0,     scw, T, dx + L,     dy,         dcw, T,   tm[1]); // top
        nineSliceRegion(ctx, img, L,     h - B, scw, B, dx + L,     dy + H - B, dcw, B,   tm[3]); // bottom
        nineSliceRegion(ctx, img, 0,     T,     L, sch, dx,         dy + T,     L,   dch, tm[0]); // left
        nineSliceRegion(ctx, img, w - R, T,     R, sch, dx + W - R, dy + T,     R,   dch, tm[2]); // right
        // centre - the bit warning stripes care about!!
        nineSliceRegion(ctx, img, L,     T,     scw, sch, dx + L,   dy + T,     dcw, dch, tm[4]);
    }

    // draws a GM room instance with its WHOLE transform (and nine-slice, if the sprite uses it)
    Util.drawInstance = function(ctx, img, spriteData, inst) {
        let ns = spriteData.nineSlice;
        ctx.save();
        ctx.globalAlpha = Util.instanceAlpha(inst);
        ctx.translate(inst.x, inst.y);
        ctx.rotate(-(inst.rotation || 0) * Math.PI / 180);
        if (ns != null && ns.enabled) {
            // keep the corners crispyyy and tile/stretch the rest to fill the scaled size. flips
            // use a sign-only scale so the slicing maths stays in happy positive space
            let ax = Math.abs(inst.scaleX), ay = Math.abs(inst.scaleY);
            let w = spriteData.width, h = spriteData.height;
            ctx.scale(inst.scaleX < 0 ? -1 : 1, inst.scaleY < 0 ? -1 : 1);
            drawNineSlice(ctx, img, ns, w, h,
                -spriteData.sequence.xorigin * ax, -spriteData.sequence.yorigin * ay,
                w * ax, h * ay);
        }
        ctx.restore();
    }

    // axis-aligned bounding box of the instance after transform
    Util.instanceBounds = function(spriteData, inst) {
        let ox = spriteData.sequence.xorigin, oy = spriteData.sequence.yorigin;
        let w = spriteData.width, h = spriteData.height;
        let sx = inst.scaleX, sy = inst.scaleY;
        let rad = -(inst.rotation || 0) * Math.PI / 180;
        let cos = Math.cos(rad), sin = Math.sin(rad);
        let corners = [
            [-ox * sx, -oy * sy],
            [(w - ox) * sx, -oy * sy],
            [(w - ox) * sx, (h - oy) * sy],
            [-ox * sx, (h - oy) * sy]
        ];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let c of corners) {
            let rx = c[0] * cos - c[1] * sin + inst.x;
            let ry = c[0] * sin + c[1] * cos + inst.y;
            if (rx < minX) minX = rx;
            if (ry < minY) minY = ry;
            if (rx > maxX) maxX = rx;
            if (ry > maxY) maxY = ry;
        }
        return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
    }

    Util.abgrToRGBA = function(abgr) {
        let r = ((abgr) % 0x100).toString(16);
        let g = (Math.floor(abgr / 0x100) % 0x100).toString(16);
        let b = (Math.floor(abgr / 0x10000) % 0x100).toString(16);
        let a = (Math.floor(abgr / 0x1000000) % 0x100).toString(16);
        if (r.length == 1) r = "0"+r;
        if (g.length == 1) g = "0"+g;
        if (b.length == 1) b = "0"+b;
        if (a.length == 1) a = "0"+a;
        return "#"+r+g+b+a;
    }

    Util.textInput = function(title, defaultValue, callback) {
        document.querySelector("#textinputfield").value = defaultValue;
        let listener = () => {
            document.querySelector("#btn_textinput").removeEventListener("click", listener);
            dialog.close();
            callback(document.querySelector("#textinputfield").value);
        }
        document.querySelector("#btn_textinput").addEventListener("click", listener);
        let dialog = new WinBox(title, {
            mount: document.querySelector("div.wb#textinput"),
            height: 67,
            x:20,
            y:100,
        });
    }

    Util.random = function(index) {
        return [202,14,88,194,70,79,134,239,131,110,109,153,41,199,0,140,130,228,40,23,210,104,247,68,5,59,167,82,61,158,24,242,105,39,155,224,174,129,76,208,19,204,237,180,151,51,98,145,4,6,211,190,181,126,245,58,195,108,223,225,87,60,249,21,16,250,90,152,102,66,226,92,183,135,123,42,207,222,164,229,252,189,200,22,46,57,139,215,33,142,99,9,157,235,176,197,160,103,227,253,84,111,50,53,165,10,156,143,27,213,13,107,83,55,115,119,187,80,161,35,56,49,86,169,43,29,31,32,125,89,48,106,96,47,72,64,3,120,7,240,234,220,221,25,85,127,170,255,178,100,168,182,75,2,122,232,69,114,179,118,209,148,163,52,212,254,112,166,17,171,198,196,26,34,45,241,150,175,251,116,244,138,44,20,191,133,177,141,154,136,11,173,121,18,231,77,201,93,246,219,186,91,137,97,117,8,54,205,214,248,147,238,62,65,185,101,63,243,144,124,30,230,184,67,81,149,36,15,188,206,236,73,71,217,193,78,128,28,132,203,94,37,159,1,218,146,95,192,12,162,74,233,216,38,172,113][Math.abs(Math.round(index)) % 256];
    }

    window.Util = Util;
})();