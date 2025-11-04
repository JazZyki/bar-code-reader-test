"use client";

import { useEffect, useRef, useState } from "react";
import ScannerControls from "./ScannerControls";
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from "@zxing/library";
import { preprocessCanvas } from "../utils/preprocessImage";
import { decodeWithQuagga } from "../utils/quaggaWrapper";

export default function VideoScanner() {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);

    // debug canvas refs
    const debugRefs = {
        gray: useRef(null),
        median: useRef(null),
        sobel: useRef(null),
        adaptive: useRef(null),
    };

    const [result, setResult] = useState("");

    const [state, setState] = useState({
        engine: "zxing",
        preview: "orig",
        median: false,
        adaptive: false,
        sobel: false,
        debug: false,
        onFile: handleFileUpload
    });

    // ---- ZXing live video mode ----
    useEffect(() => {
        if (state.engine !== "zxing") return;

        const reader = new BrowserMultiFormatReader();
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);

        let active = true;

        reader.decodeFromVideoDevice(null, videoRef.current, (res) => {
            if (!active) return;
            if (res) setResult(res.getText());
        }, { hints });

        return () => {
            active = false;
            reader.reset();
        };
    }, [state.engine]);

    async function drawDebugFrames(sourceCanvas) {
        const steps = {
            gray:  { median: false, sobel: false, adaptive: false },
            median:{ median: true,  sobel: false, adaptive: false },
            sobel: { median: true,  sobel: true,  adaptive: false },
            adaptive: { median: true, sobel: true, adaptive: true }
        };

        for (const key of Object.keys(steps)) {
            const outCanvas = preprocessCanvas(sourceCanvas, steps[key]);
            const ref = debugRefs[key].current;
            const ctx = ref.getContext("2d");
            ctx.drawImage(outCanvas, 0, 0);
        }
    }

    async function processFrame() {
        if (state.engine === "zxing") return; // ZXing already handles video

        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;

        if (video.videoWidth === 0 || video.videoHeight === 0) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, 0, 0);

        // debug — render all stages
        if (state.debug) {
            Object.values(debugRefs).forEach(ref => {
                ref.current.width  = video.videoWidth;
                ref.current.height = video.videoHeight;
            });
            drawDebugFrames(canvas);
        }

        // preview processed output instead of raw
        if (state.preview === "processed") {
            const processed = preprocessCanvas(canvas, {
                median: state.median,
                sobel: state.sobel,
                adaptive: state.adaptive
            });
            ctx.drawImage(processed, 0, 0);
        }

        if (state.engine === "quagga") {
            try {
                const code = await decodeWithQuagga(canvas);
                if (code) setResult(code);
            } catch {}
        }
    }

    // quagga polling
    useEffect(() => {
        if (state.engine !== "quagga") return;
        const interval = setInterval(processFrame, 200);
        return () => clearInterval(interval);
    }, [state]);

    // file upload scan
    async function handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const img = new Image();
        img.src = URL.createObjectURL(file);

        img.onload = async () => {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });

            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            const processed = preprocessCanvas(canvas, state);
            try {
                const code = await decodeWithQuagga(processed);
                setResult(code);
            } catch {
                setResult("❌ Nenalezeno");
            }
        };
    }

    return (
        <div style={{ padding: 20 }}>
            <ScannerControls state={state} setState={setState} />

            <video
                ref={videoRef}
                autoPlay
                style={{ width: "100%", maxWidth: 480, borderRadius: 8 }}
            />

            <canvas
                ref={canvasRef}
                style={{ display: state.preview !== "orig" ? "block" : "none",
                         width: "100%", maxWidth: 480, marginTop: 10 }}
            />

            {state.debug && (
                <div style={{ marginTop: 10 }}>
                    <h4 style={{ marginBottom: 8 }}>Debug pipeline</h4>
                    <div style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2,1fr)",
                        gap: 8
                    }}>
                        <div><div>Gray</div><canvas ref={debugRefs.gray} style={{ width:"100%" }}/></div>
                        <div><div>Median</div><canvas ref={debugRefs.median} style={{ width:"100%" }}/></div>
                        <div><div>Sobel</div><canvas ref={debugRefs.sobel} style={{ width:"100%" }}/></div>
                        <div><div>Adaptive</div><canvas ref={debugRefs.adaptive} style={{ width:"100%" }}/></div>
                    </div>
                </div>
            )}

            <p style={{ marginTop: 10, fontSize: 18 }}>
                {result ? `📦 Kód: ${result}` : "▶️ Namiř kameru na CODE-128"}
            </p>
        </div>
    );
}
