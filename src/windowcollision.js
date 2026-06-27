(function() {
    if (typeof WinBox === "undefined") return;

    // Make windows "crash into" each other when you drag a resize handle

    function rectOf(box) { return { x: box.x, y: box.y, w: box.width, h: box.height }; }
    function valid(b, box) { return b !== box && !b.min && !b.max && !b.hidden && b.g; }

    // The fixed top menu bar is a wall windows can't be resized up into.
    let menubar = document.querySelector(".menubar");
    function menubarBottom() {
        return menubar ? menubar.getBoundingClientRect().bottom : -Infinity;
    }

    function resolveCollision(box) {
        let prev = box._collPrev;
        if (!prev) { box._collPrev = rectOf(box); return; }

        let left = box.x, top = box.y, right = box.x + box.width, bottom = box.y + box.height;
        let prevLeft = prev.x, prevTop = prev.y, prevRight = prev.x + prev.w, prevBottom = prev.y + prev.h;
        let stack = WinBox.stack();
        
        // right edge moved right
        if (right > prevRight) {
            let wall = Infinity;
            for (let b of stack) {
                if (!valid(b, box)) continue;
                if (top < b.y + b.height && b.y < bottom && b.x >= prevRight && b.x < right && b.x < wall) wall = b.x;
            }
            if (wall !== Infinity) right = wall;
        }
        // left edge moved left
        if (left < prevLeft) {
            let wall = -Infinity;
            for (let b of stack) {
                if (!valid(b, box)) continue;
                let br = b.x + b.width;
                if (top < b.y + b.height && b.y < bottom && br <= prevLeft && br > left && br > wall) wall = br;
            }
            if (wall !== -Infinity) left = wall;
        }
        // bottom edge moved down
        if (bottom > prevBottom) {
            let wall = Infinity;
            for (let b of stack) {
                if (!valid(b, box)) continue;
                if (left < b.x + b.width && b.x < right && b.y >= prevBottom && b.y < bottom && b.y < wall) wall = b.y;
            }
            if (wall !== Infinity) bottom = wall;
        }    
        // top edge moved up
        if (top < prevTop) {
            let wall = -Infinity;
            for (let b of stack) {
                if (!valid(b, box)) continue;
                let bb = b.y + b.height;
                if (left < b.x + b.width && b.x < right && bb <= prevTop && bb > top && bb > wall) wall = bb;
            }
            // the top menu bar spans the full width, so it always overlaps horizontally
            let mb = menubarBottom();
            if (mb <= prevTop && mb > top && mb > wall) wall = mb;
            if (wall !== -Infinity) top = wall;
        }

        box.x = left;
        box.y = top;
      
        box.width = Math.max(0, right - left);
        box.height = Math.max(0, bottom - top);
    }

    let origResize = WinBox.prototype.resize;
    WinBox.prototype.resize = function(w, h, c) {
        if (w === undefined && !c && !this.max && !this.min && !this.hidden
            && document.body.classList.contains("wb-lock")) {
            resolveCollision(this);
        }
        let ret = origResize.call(this, w, h, c);
        this._collPrev = rectOf(this);
        return ret;
    };

    // Track moves too so the next resize has a correct baseline
    let origMove = WinBox.prototype.move;
    WinBox.prototype.move = function(x, y, c) {
        let ret = origMove.call(this, x, y, c);
        this._collPrev = rectOf(this);
        return ret;
    };
})();
