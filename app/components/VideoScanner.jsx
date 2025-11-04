"use client";

import { useEffect, useRef, useState } from "react";
import ScannerControls from "./ScannerControls";
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from "@zxing/library";
import { preprocessCanvas } from "../utils/preprocessImage";
import { decodeWithQuagga } from "../utils/quaggaWrapper";

/**
 * VideoScanner component
 * - ZXing live scanning
 * - Quagga fallback / hybrid
 * - ROI overlay (center)
 * - Bounding box drawing (from ZXing result points)
 * - Autofocus attempt (applyConstraints)
 * - CLAHE and Unsharp as optional enhancements (JS implementations here)
 * - Debug canvases: gray / median / sobel / adaptive
 */

export default function VideoScanner() {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const overlayRef = useRef(null); // for ROI and bounding boxes

    // debug canvas refs
    const debugRefs = {
        gray: useRef(null),
        median: useRef(null),
        sobel: useRef(null),
        adaptive: useRef(null),
    };

    const [result, setResult] = useState("");
    const [lastZxingTime, setLastZxingTime] = useState(0);

    const [state, setState] = useState({
        engine: "zxing",      // 'zxing' | 'quagga' | 'hybrid'
        preview: "orig",      // 'orig' | 'gray' | 'processed'
        median: false,
        adaptive: false,
        sobel: false,
        debug: false,
        useROI: true,
        clahe: false,
        unsharp: false,
        onFile: handleFileUpload,   // will be hoisted once defined
        onAutoFocus: tryEnableContinuousFocus
    });

    // ----------------- ZXing live scanning (with bounding box) -----------------
    useEffect(() => {
        if (state.engine === "quagga") return;
        // if engine is 'hybrid' still run ZXing live for fast detection
        const reader = new BrowserMultiFormatReader();
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);

        let active = true;
        // ZXing will attach the camera stream itself
        reader.decodeFromVideoDevice(null, videoRef.current, (res, err) => {
            if (!active) return;
            if (res) {
                setResult(res.getText());
                setLastZxingTime(Date.now());
                drawZXingBoundingBox(res);
            } else {
                // no result this frame — clear overlay bounding box?
                // don't clear immediately to avoid flicker
            }
        }, { hints });

        return () => {
            active = false;
            reader.reset();
            clearOverlay();
        };
    }, [state.engine, state.useROI]);

    // ----------------- Hybrid fallback: poll frames and call Quagga when ZXing quiet -----------------
    useEffect(() => {
        const interval = setInterval(async () => {
            // If user explicitly selected quagga only -> always process frames
            if (!videoRef.current) return;
            const now = Date.now();

            const shouldRunQuagga =
                state.engine === "quagga" ||
                (state.engine === "hybrid" && (now - lastZxingTime > 2000)); // 2s no ZXing -> fallback

            if (shouldRunQuagga) {
                await processFrame({ runQuagga: true, drawPreviewIfProcessed: true });
            } else {
                // still do debug preview frames if requested (no heavy decode)
                if (state.debug && state.engine === "hybrid") {
                    await processFrame({ runQuagga: false, drawPreviewIfProcessed: true });
                }
            }
        }, 300); // ~3-4 fps for Quagga fallback
        return () => clearInterval(interval);
    }, [state, lastZxingTime]);

    // ----------------- processFrame: draw video -> optionally ROI crop -> enhancements -> decode with Quagga -----------------
    async function processFrame({ runQuagga = false, drawPreviewIfProcessed = false } = {}) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;
        if (video.videoWidth === 0 || video.videoHeight === 0) return;

        // Compute ROI in source video coords
        const sx = state.useROI ? Math.floor(video.videoWidth * 0.15) : 0;
        const sy = state.useROI ? Math.floor(video.videoHeight * 0.35) : 0;
        const sWidth = state.useROI ? Math.floor(video.videoWidth * 0.7) : video.videoWidth;
        const sHeight = state.useROI ? Math.floor(video.videoHeight * 0.3) : video.videoHeight;

        // Draw ROI crop into working canvas
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        // Set output canvas to ROI size (so preprocess/Quagga sees the cropped region)
        canvas.width = sWidth;
        canvas.height = sHeight;

        try {
            // draw the ROI region from the video into the canvas
            ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
        } catch (err) {
            // sometimes drawImage throws if video not ready — ignore
            return;
        }

        // optionally apply CLAHE + unsharp before the existing preprocess
        if (state.clahe || state.unsharp) {
            // get image data
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            let out = imgData;
            if (state.clahe) {
                out = applyCLAHE(out, 8, 40); // tileSize=8, clipLimit=40
            }
            if (state.unsharp) {
                out = unsharpMask(out, 1, 1.0); // radius=1, amount=1
            }
            ctx.putImageData(out, 0, 0);
        }

        // For debug views: prepare processed canvases
        if (state.debug) {
            Object.values(debugRefs).forEach(ref => {
                if (!ref.current) return;
                ref.current.width = canvas.width;
                ref.current.height = canvas.height;
            });
            // produce debug pipeline canvases using preprocessCanvas
            drawDebugFrames(canvas);
        }

        // preview processed on main canvas if requested
        if (state.preview === "processed") {
            const processed = preprocessCanvas(canvas, {
                median: state.median,
                sobel: state.sobel,
                adaptive: state.adaptive
            });
            // draw processed back
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(processed, 0, 0);
        } else if (state.preview === "gray") {
            // draw just grayscale
            const g = preprocessCanvas(canvas, { median: false, sobel: false, adaptive: false });
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(g, 0, 0);
        }

        if (runQuagga) {
            try {
                const code = await decodeWithQuagga(canvas);
                if (code) {
                    setResult(code);
                    // draw bounding box will be approximate (we don't have box coords from quaggaWrapper)
                    drawQuaggaBoxApprox();
                }
            } catch (e) {
                // ignored
            }
        }
    }

    // ----------------- Debug frames rendering helper -----------------
    function drawDebugFrames(sourceCanvas) {
        try {
            // gray (just grayscale)
            const gray = preprocessCanvas(sourceCanvas, { median: false, sobel: false, adaptive: false });
            if (debugRefs.gray.current) debugRefs.gray.current.getContext("2d").drawImage(gray, 0, 0);

            // median
            const med = preprocessCanvas(sourceCanvas, { median: true, sobel: false, adaptive: false });
            if (debugRefs.median.current) debugRefs.median.current.getContext("2d").drawImage(med, 0, 0);

            // sobel
            const sob = preprocessCanvas(sourceCanvas, { median: true, sobel: true, adaptive: false });
            if (debugRefs.sobel.current) debugRefs.sobel.current.getContext("2d").drawImage(sob, 0, 0);

            // adaptive threshold
            const thr = preprocessCanvas(sourceCanvas, { median: true, sobel: true, adaptive: true });
            if (debugRefs.adaptive.current) debugRefs.adaptive.current.getContext("2d").drawImage(thr, 0, 0);
        } catch (err) {
            // ignore occasional errors while video initializing
        }
    }

    // ----------------- Bounding box drawing from ZXing result -----------------
    function drawZXingBoundingBox(zxingResult) {
        try {
            const overlay = overlayRef.current;
            if (!overlay || !zxingResult) return;
            const ctx = overlay.getContext("2d");
            // clear
            ctx.clearRect(0, 0, overlay.width, overlay.height);

            // convert result points (relative to video) to overlay coords
            const pts = zxingResult.getResultPoints ? zxingResult.getResultPoints() : null;
            if (!pts || pts.length === 0) return;

            // overlay size corresponds to displayed video size; we want to draw relative to ROI mapping
            // We assume overlay has same displayed pixel size as video element; compute scale from ROI cropping
            const video = videoRef.current;
            const videoDisplayWidth = overlay.width;
            const videoDisplayHeight = overlay.height;

            // For simplicity we will draw bounding polygon scaled from ROI crop to overlay:
            // Note: ZXing points are in camera pixel coords; to adapt correctly we'd need camera resolution.
            // We'll draw approximate box in overlay center (visual hint).
            ctx.strokeStyle = "lime";
            ctx.lineWidth = 3;
            ctx.beginPath();

            // compute bounding box from pts
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            pts.forEach(p => {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
            });

            // pts from ZXing may be in camera pixel space. We'll map them into overlay coordinates
            // by scaling by videoRef.videoWidth -> overlay.width
            if (video && video.videoWidth && video.videoHeight) {
                const scaleX = overlay.width / video.videoWidth;
                const scaleY = overlay.height / video.videoHeight;

                ctx.rect(minX * scaleX, minY * scaleY, (maxX - minX) * scaleX, (maxY - minY) * scaleY);
                ctx.stroke();
            } else {
                // fallback: center small box
                const w = overlay.width * 0.5;
                const h = overlay.height * 0.2;
                ctx.rect((overlay.width - w) / 2, (overlay.height - h) / 2, w, h);
                ctx.stroke();
            }
        } catch (err) {
            // ignore drawing errors
        }
    }

    function drawQuaggaBoxApprox() {
        // approximate bounding box in overlay center (when Quagga returns code but we don't have polygon)
        const overlay = overlayRef.current;
        if (!overlay) return;
        const ctx = overlay.getContext("2d");
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        ctx.strokeStyle = "orange";
        ctx.lineWidth = 3;
        const w = overlay.width * 0.6;
        const h = overlay.height * 0.2;
        ctx.strokeRect((overlay.width - w) / 2, (overlay.height - h) / 2, w, h);
    }

    function clearOverlay() {
        const overlay = overlayRef.current;
        if (!overlay) return;
        const ctx = overlay.getContext("2d");
        ctx.clearRect(0, 0, overlay.width, overlay.height);
    }

    // ----------------- TRY autofocus (best-effort) -----------------
    async function tryEnableContinuousFocus() {
        try {
            const video = videoRef.current;
            if (!video) return;
            const stream = video.srcObject;
            if (!stream) {
                // if ZXing attached the stream, video.srcObject might be set; otherwise try to get it
                const s = await navigator.mediaDevices.getUserMedia({ video: true });
                video.srcObject = s;
            }
            const tracks = (video.srcObject && video.srcObject.getVideoTracks && video.srcObject.getVideoTracks()) || [];
            if (!tracks || tracks.length === 0) {
                console.warn("No video track found for autofocus");
                return;
            }
            const track = tracks[0];
            // try apply constraints - browser support varies
            const constraints = {
                advanced: [
                    // these are best-effort and may be ignored
                    { focusMode: "continuous" },
                    { focusMode: "auto" }
                ]
            };
            await track.applyConstraints(constraints);
            // try focusDistance if available
            try {
                await track.applyConstraints({ advanced: [{ focusDistance: 0.0 }] });
            } catch (e) {
                // ignore
            }
            console.log("Autofocus: applyConstraints attempted.");
        } catch (err) {
            console.warn("Autofocus attempt failed:", err);
        }
    }

    // ----------------- File upload handling -----------------
    async function handleFileUpload(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const img = new Image();
        img.src = URL.createObjectURL(file);

        img.onload = async () => {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });

            // draw full image to canvas
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            // optionally apply CLAHE/unsharp first
            if (state.clahe || state.unsharp) {
                const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
                let out = id;
                if (state.clahe) out = applyCLAHE(out, 8, 40);
                if (state.unsharp) out = unsharpMask(out, 1, 1.0);
                ctx.putImageData(out, 0, 0);
            }

            const processed = preprocessCanvas(canvas, {
                median: state.median,
                sobel: state.sobel,
                adaptive: state.adaptive
            });

            try {
                const code = await decodeWithQuagga(processed);
                setResult(code);
            } catch (err) {
                setResult("❌ Nenalezeno");
            }
        };
    }

    // expose handlers into state for controls
    useEffect(() => {
        setState(s => ({ ...s, onFile: handleFileUpload, onAutoFocus: tryEnableContinuousFocus }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ----------------- Setup overlay sizing to match displayed video -----------------
    useEffect(() => {
        function resizeOverlay() {
            const video = videoRef.current;
            const overlay = overlayRef.current;
            if (!video || !overlay) return;
            // overlay pixel size should match displayed size of video element
            const rect = video.getBoundingClientRect();
            overlay.width = rect.width;
            overlay.height = rect.height;
            // position overlay absolute over video via CSS (we set inline styles in JSX)
        }

        window.addEventListener("resize", resizeOverlay);
        const t = setTimeout(resizeOverlay, 500);
        return () => {
            clearTimeout(t);
            window.removeEventListener("resize", resizeOverlay);
        };
    }, []);

    // ----------------- Utility: Simple CLAHE (tile-based histogram equalization) -----------------
    function applyCLAHE(imgData, tileSize = 8, clipLimit = 40) {
        // Works on grayscale channels (we assume imgData is grayscale already or will operate on luminance)
        const w = imgData.width;
        const h = imgData.height;
        const nTilesX = Math.max(1, Math.floor(w / tileSize));
        const nTilesY = Math.max(1, Math.floor(h / tileSize));
        const out = new Uint8ClampedArray(imgData.data); // copy

        // convert to luminance array
        const lum = new Uint8ClampedArray((w * h));
        for (let i = 0, p = 0; i < imgData.data.length; i += 4, p++) {
            // use existing grayscale if present or compute luminance
            lum[p] = imgData.data[i]; // assuming preprocess earlier set grayscale; if not, it's approx
        }

        // For each tile compute histogram and LUT
        for (let ty = 0; ty < nTilesY; ty++) {
            for (let tx = 0; tx < nTilesX; tx++) {
                const x0 = Math.floor(tx * w / nTilesX);
                const y0 = Math.floor(ty * h / nTilesY);
                const x1 = Math.floor((tx + 1) * w / nTilesX);
                const y1 = Math.floor((ty + 1) * h / nTilesY);

                const hist = new Uint32Array(256);
                for (let y = y0; y < y1; y++) {
                    for (let x = x0; x < x1; x++) {
                        hist[lum[y * w + x]]++;
                    }
                }

                // clip histogram
                let excess = 0;
                const maxCount = clipLimit;
                for (let i = 0; i < 256; i++) {
                    if (hist[i] > maxCount) {
                        excess += hist[i] - maxCount;
                        hist[i] = maxCount;
                    }
                }
                // redistribute excess
                const inc = Math.floor(excess / 256);
                for (let i = 0; i < 256; i++) hist[i] += inc;

                // cumulative
                const cdf = new Uint32Array(256);
                cdf[0] = hist[0];
                for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];
                const cdfMin = cdf[0];
                const area = (x1 - x0) * (y1 - y0);

                // LUT
                const lut = new Uint8Array(256);
                for (let i = 0; i < 256; i++) {
                    lut[i] = Math.min(255, Math.max(0, Math.round((cdf[i] - cdfMin) / (area - cdfMin) * 255)));
                }

                // map tile pixels
                for (let y = y0; y < y1; y++) {
                    for (let x = x0; x < x1; x++) {
                        const idx = y * w + x;
                        const v = lut[lum[idx]];
                        const outPos = idx * 4;
                        out[outPos] = out[outPos + 1] = out[outPos + 2] = v;
                        // alpha unchanged
                    }
                }
            }
        }
        return new ImageData(out, w, h);
    }

    // ----------------- Utility: Unsharp mask (simple) -----------------
    function unsharpMask(imgData, radius = 1, amount = 1.0) {
        // Simple box blur as blur approximation then add difference
        const w = imgData.width;
        const h = imgData.height;
        const src = imgData.data;
        const blurred = new Uint8ClampedArray(src.length);

        // box blur kernel size = 3 (radius=1)
        const k = radius;
        const kernelSize = 2 * k + 1;
        const area = kernelSize * kernelSize;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let sum = 0;
                for (let j = -k; j <= k; j++) {
                    const yy = Math.min(h - 1, Math.max(0, y + j));
                    for (let i = -k; i <= k; i++) {
                        const xx = Math.min(w - 1, Math.max(0, x + i));
                        sum += src[(yy * w + xx) * 4]; // assume grayscale in R
                    }
                }
                const avg = Math.round(sum / area);
                const p = (y * w + x) * 4;
                blurred[p] = blurred[p + 1] = blurred[p + 2] = avg;
                blurred[p + 3] = 255;
            }
        }

        // combine: result = src + amount * (src - blurred)
        const out = new Uint8ClampedArray(src.length);
        for (let i = 0; i < src.length; i += 4) {
            const orig = src[i];
            const b = blurred[i];
            let v = Math.round(orig + amount * (orig - b));
            v = Math.max(0, Math.min(255, v));
            out[i] = out[i + 1] = out[i + 2] = v;
            out[i + 3] = 255;
        }
        return new ImageData(out, w, h);
    }

    // ----------------- Render -----------------
    return (
        <div style={{ padding: 20 }}>
            <ScannerControls state={state} setState={setState} />

            <div style={{ position: "relative", width: "100%", maxWidth: 640 }}>
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{ width: "100%", borderRadius: 8, display: "block" }}
                />

                {/* overlay canvas positioned on top of video for ROI and bounding boxes */}
                <canvas
                    ref={overlayRef}
                    style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        pointerEvents: "none",
                        width: "100%",
                        height: "100%",
                        borderRadius: 8
                    }}
                />
            </div>

            {/* working canvas (hidden or shown depending on preview) */}
            <canvas
                ref={canvasRef}
                style={{
                    display: state.preview === "orig" ? "none" : "block",
                    width: "100%",
                    maxWidth: 640,
                    marginTop: 10,
                    borderRadius: 6
                }}
            />

            {/* debug canvases */}
            {state.debug && (
                <div style={{ marginTop: 10 }}>
                    <h4 style={{ marginBottom: 8 }}>Debug pipeline</h4>
                    <div style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2,1fr)",
                        gap: 8
                    }}>
                        <div><div>Gray</div><canvas ref={debugRefs.gray} style={{ width: "100%" }} /></div>
                        <div><div>Median</div><canvas ref={debugRefs.median} style={{ width: "100%" }} /></div>
                        <div><div>Sobel</div><canvas ref={debugRefs.sobel} style={{ width: "100%" }} /></div>
                        <div><div>Adaptive</div><canvas ref={debugRefs.adaptive} style={{ width: "100%" }} /></div>
                    </div>
                </div>
            )}

            <p style={{ marginTop: 10, fontSize: 18 }}>
                {result ? `📦 Kód: ${result}` : "▶️ Namiř kameru na CODE-128"}
            </p>
        </div>
    );
}
