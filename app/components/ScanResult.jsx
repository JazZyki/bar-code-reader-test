"use client";
import React from "react";

export default function ScanResult({ result }) {
    if (!result?.text) return null;

    const formatLabels = {
        "EAN_13": "EAN-13",
        "EAN_8": "EAN-8",
        "CODE_128": "Code-128",
        "CODE_39": "Code-39",
        "UPC_A": "UPC-A",
        "QR_CODE": "QR kód"
    };

    const label = formatLabels[result.format] || result.format;

    return (
        <div className="mt-4 rounded-xl bg-white shadow p-4 border text-sm">
            <div className="font-semibold mb-2">📦 Naskenovaný kód</div>

            <div className="mb-1">
                <span className="font-medium">Hodnota:</span>
                <span className="ml-2 text-base font-mono bg-gray-100 px-2 py-1 rounded">
                    {result.text}
                </span>
            </div>

            <div>
                <span className="font-medium">Typ kódu:</span>
                <span className="ml-2 text-base font-mono bg-gray-100 px-2 py-1 rounded">
                    {label}
                </span>
            </div>
        </div>
    );
}
