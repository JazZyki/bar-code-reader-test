"use client";
import VideoScanner from "../app/components/VideoScanner";


export default function Page() {
    return (
        <main style={{ padding: 20 }}>
            <h1>ZXing Code‑128 Scanner + Preprocessing</h1>
            <VideoScanner />
        </main>
    );
}