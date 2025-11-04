"use client";

import { useEffect, useRef, useState } from "react";
import ScannerControls from "./ScannerControls";
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from "@zxing/library";
import { preprocessCanvas } from "../utils/preprocessImage";
import { decodeWithQuagga } from "../utils/quaggaWrapper";

export default function VideoScanner() {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const overlayRef = useRef(null);

    const [result, setResult] = useState("");
    const [lastZxingTime, setLastZxingTime] = useState(0);

    const [state, setState] = useState({
        median: false,
        adaptive: false,
        sobel: false,
        preview: "orig", // orig | gray | processed
        useROI: true
    });

    const [torchSupported, setTorchSupported] = useState(false);
    const [torchEnabled, setTorchEnabled] = useState(false);
    const [videoTrack, setVideoTrack] = useState(null);


    const formatMap = {
        1: "AZTEC",
        2: "CODABAR",
        3: "CODE_39",
        4: "CODE_128",
        5: "DATA_MATRIX",
        6: "EAN_8",
        7: "EAN_13",
        8: "ITF",
        9: "MAXICODE",
        10: "PDF_417",
        11: "QR_CODE",
        12: "RSS_14",
        13: "RSS_EXPANDED",
        14: "UPC_A",
        15: "UPC_E",
        16: "UPC_EAN_EXTENSION"
    };

    // ----------------- ZXing live scanning (with bounding box) -----------------
    useEffect(() => {
        const reader = new BrowserMultiFormatReader();
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.EAN_13]);

        let active = true;

        async function startVideo() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
                if (!videoRef.current) return;
                videoRef.current.srcObject = stream;

                // bezpečné play() s catch na AbortError
                videoRef.current.play().catch(err => {
                    if (err.name !== "AbortError") console.warn("Play interrupted:", err);
                });

                reader.decodeFromVideoDevice(null, videoRef.current, (res) => {
                    if (!active) return;
                    if (res) {
                        setResult(`${res.getText()} (${formatMap[res.getBarcodeFormat()] || "UNKNOWN"})`);
                        setLastZxingTime(Date.now());
                        drawZXingBoundingBox(res);
                    }
                }, { hints });
            } catch (err) {
                console.error("Camera init failed:", err);
            }
        }

        startVideo();

        return () => {
            active = false;
            reader.reset();
            clearOverlay();
            if (videoRef.current && videoRef.current.srcObject) {
                videoRef.current.srcObject.getTracks().forEach(track => track.stop());
                videoRef.current.srcObject = null;
            }
        };
    }, []);

    // ----------------- Torch toggle -----------------
    useEffect(() => {
        if (!videoTrack) return;
        const caps = videoTrack.getCapabilities();
        if (!caps.torch) return;

        videoTrack.applyConstraints({ advanced: [{ torch: torchEnabled }] }).catch(() => {
            console.warn("Torch applyConstraints failed");
        });
    }, [torchEnabled, videoTrack]);

    // ----------------- Hybrid fallback: poll frames and call Quagga -----------------
    useEffect(() => {
        const interval = setInterval(async () => {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            if (!video || !canvas) return;
            const now = Date.now();

            const shouldRunQuagga = now - lastZxingTime > 2000; // fallback pokud ZXing ticho > 2s
            if (!shouldRunQuagga) return;

            await processFrame(canvas);
        }, 300);

        return () => clearInterval(interval);
    }, [lastZxingTime, state.median, state.adaptive, state.sobel]);

    // ----------------- processFrame: preprocess + Quagga decode -----------------
    async function processFrame(canvas) {
        const video = videoRef.current;
        if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

        const sx = state.useROI ? Math.floor(video.videoWidth * 0.15) : 0;
        const sy = state.useROI ? Math.floor(video.videoHeight * 0.35) : 0;
        const sWidth = state.useROI ? Math.floor(video.videoWidth * 0.7) : video.videoWidth;
        const sHeight = state.useROI ? Math.floor(video.videoHeight * 0.3) : video.videoHeight;

        canvas.width = sWidth;
        canvas.height = sHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);

        const processed = preprocessCanvas(canvas, {
            median: state.median,
            sobel: state.sobel,
            adaptive: state.adaptive
        });
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(processed, 0, 0);

        try {
            const code = await decodeWithQuagga(processed);
            if (code) {
                setResult(`${code} (Unknown type)`); // Quagga2 neumí vrátit formát přímo
                drawQuaggaBoxApprox();
            }
        } catch (err) {
            // ignorovat nenalezeno
        }
    }

    // ----------------- Overlay helpers -----------------
    function drawZXingBoundingBox(zxingResult) {
        try {
            const overlay = overlayRef.current;
            if (!overlay) return;
            const ctx = overlay.getContext("2d");
            ctx.clearRect(0, 0, overlay.width, overlay.height);

            const pts = zxingResult.getResultPoints ? zxingResult.getResultPoints() : null;
            if (!pts || pts.length === 0) return;

            const video = videoRef.current;
            const scaleX = overlay.width / video.videoWidth;
            const scaleY = overlay.height / video.videoHeight;

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            pts.forEach(p => {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
            });

            ctx.strokeStyle = "lime";
            ctx.lineWidth = 3;
            ctx.strokeRect(minX * scaleX, minY * scaleY, (maxX - minX) * scaleX, (maxY - minY) * scaleY);
        } catch (err) { }
    }

    function drawQuaggaBoxApprox() {
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
        overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
    }

    async function toggleTorch() {
        try {
            const video = videoRef.current;
            if (!video || !video.srcObject) return;

            const track = video.srcObject.getVideoTracks()[0];
            const capabilities = track.getCapabilities();
            if (!capabilities.torch) {
                console.warn("Torch not supported on this device.");
                return;
            }

            await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
            setTorchOn(!torchOn);
        } catch (err) {
            console.error("Torch toggle failed:", err);
        }
    }

    // ----------------- Render -----------------
    return (
        <div style={{ padding: 20 }}>
            <ScannerControls state={state} setState={setState} />

            {torchSupported ? (
                <button
                    onClick={() => setTorchEnabled(v => !v)}
                    style={{
                        padding: "10px 20px",
                        background: torchEnabled ? "#facc15" : "#e5e7eb",
                        borderRadius: 8,
                        fontSize: 16,
                        cursor: "pointer",
                        marginBottom: 12
                    }}
                >
                    🔦 {torchEnabled ? "Vypnout světlo" : "Zapnout světlo"}
                </button>
            ) : (
                <p style={{ fontSize: 14, opacity: 0.6, marginBottom: 8 }}>
                    🔋 Přisvícení není podporováno na tomto zařízení.
                    <br />iPhone Safari? Zapni svítilnu ručně 😉
                </p>
            )}

            <div style={{ position: "relative", width: "100%", maxWidth: 640 }}>
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{ width: "100%", borderRadius: 8, display: "block" }}
                />

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

            <canvas
                ref={canvasRef}
                style={{
                    display: "none"
                }}
            />

            <p style={{ marginTop: 10, fontSize: 18 }}>
                {result ? `📦 Kód: ${result}` : "▶️ Namiř kameru na čárový kód"}
            </p>
        </div>
    );
}
