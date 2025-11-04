"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from "@zxing/library";

export default function VideoScanner() {
    const videoRef = useRef(null);
    const [result, setResult] = useState("");

    useEffect(() => {
        const reader = new BrowserMultiFormatReader();

        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);

        reader.decodeFromVideoDevice(null, videoRef.current, (res) => {
            if (res) setResult(res.getText());
        }, { hints });

        return () => reader.reset();
    }, []);

    return (
        <div style={{ textAlign: "center", padding: "20px" }}>
            <video
                ref={videoRef}
                style={{ width: "100%", maxWidth: "480px", borderRadius: "10px" }}
            />
            <p style={{ fontSize: "18px", marginTop: "10px" }}>
                {result ? `📦 Kód: ${result}` : "▶️ Namiř kameru na CODE-128"}
            </p>
        </div>
    );
}
