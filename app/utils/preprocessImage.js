function grayscalePixels(data) {
    for (let i = 0; i < data.length; i += 4) {
        const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
        data[i] = data[i + 1] = data[i + 2] = v;
    }
}

function cloneImageData(imgData) {
    return new ImageData(new Uint8ClampedArray(imgData.data), imgData.width, imgData.height);
}

function medianBlur(imgData, radius = 1) {
    const w = imgData.width;
    const h = imgData.height;
    const src = imgData.data;
    const out = new Uint8ClampedArray(src.length);


    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const vals = [];
            for (let ry = -radius; ry <= radius; ry++) {
                for (let rx = -radius; rx <= radius; rx++) {
                    const nx = Math.max(0, Math.min(w - 1, x + rx));
                    const ny = Math.max(0, Math.min(h - 1, y + ry));
                    const idx = (ny * w + nx) * 4;
                    vals.push(src[idx]);
                }
            }
            vals.sort((a, b) => a - b);
            const m = vals[Math.floor(vals.length / 2)];
            const outIdx = (y * w + x) * 4;
            out[outIdx] = out[outIdx + 1] = out[outIdx + 2] = m;
            out[outIdx + 3] = 255;
        }
    }
    return new ImageData(out, w, h);
}

function adaptiveThreshold(imgData, windowSize = 15, c = 7) {
    // simple mean filter adaptive threshold
    const w = imgData.width;
    const h = imgData.height;
    const src = imgData.data;
    const out = new Uint8ClampedArray(src.length);


    // integral image for mean
    const integral = new Uint32Array((w + 1) * (h + 1));
    for (let y = 1; y <= h; y++) {
        let rowSum = 0;
        for (let x = 1; x <= w; x++) {
            const v = src[((y - 1) * w + (x - 1)) * 4];
            rowSum += v;
            integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + rowSum;
        }
    }


    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const x1 = Math.max(0, x - Math.floor(windowSize / 2));
            const y1 = Math.max(0, y - Math.floor(windowSize / 2));
            const x2 = Math.min(w - 1, x + Math.floor(windowSize / 2));
            const y2 = Math.min(h - 1, y + Math.floor(windowSize / 2));


            const count = (x2 - x1 + 1) * (y2 - y1 + 1);
            const sum = integral[(y2 + 1) * (w + 1) + (x2 + 1)] - integral[(y1) * (w + 1) + (x2 + 1)] - integral[(y2 + 1) * (w + 1) + (x1)] + integral[(y1) * (w + 1) + (x1)];
            const mean = sum / count;


            const idx = (y * w + x) * 4;
            const v = src[idx];
            const val = v < (mean - c) ? 0 : 255;
            out[idx] = out[idx + 1] = out[idx + 2] = val;
            out[idx + 3] = 255;
        }
    }


    return new ImageData(out, w, h);
}

function sobelEnhance(imgData) {
    const w = imgData.width;
    const h = imgData.height;
    const src = imgData.data;
    const out = new Uint8ClampedArray(src.length);


    const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];


    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            let sx = 0;
            let sy = 0;
            let k = 0;
            for (let j = -1; j <= 1; j++) {
                for (let i = -1; i <= 1; i++) {
                    const v = src[((y + j) * w + (x + i)) * 4];
                    sx += gx[k] * v;
                    sy += gy[k] * v;
                    k++;
                }
            }
            const mag = Math.min(255, Math.sqrt(sx * sx + sy * sy));
            const idx = (y * w + x) * 4;
            out[idx] = out[idx + 1] = out[idx + 2] = mag;
            out[idx + 3] = 255;
        }
    }
    return new ImageData(out, w, h);
}


export function preprocessCanvas(sourceCanvas, opts = {}) {
    const canvas = document.createElement('canvas');
    const w = (canvas.width = sourceCanvas.width);
    const h = (canvas.height = sourceCanvas.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(sourceCanvas, 0, 0, w, h);


    let imgData = ctx.getImageData(0, 0, w, h);
    grayscalePixels(imgData.data);


    if (opts.median === true) {
        imgData = medianBlur(imgData, opts.medianRadius || 1);
    }


    if (opts.sobel === true) {
        imgData = sobelEnhance(imgData);
    }


    if (opts.adaptive === true) {
        imgData = adaptiveThreshold(imgData, opts.windowSize || 15, opts.c || 7);
    } else if (opts.threshold) {
        // global threshold
        const t = opts.threshold;
        for (let i = 0; i < imgData.data.length; i += 4) {
            const v = imgData.data[i] < t ? 0 : 255;
            imgData.data[i] = imgData.data[i + 1] = imgData.data[i + 2] = v;
        }
    }


    ctx.putImageData(imgData, 0, 0);
    return canvas;
}