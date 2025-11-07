'use client';
import React from 'react';

export default function ScannerControls({ state, setState }) {
    return (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <label>
                Engine:
                <select value={state.engine} onChange={e => setState(s => ({ ...s, engine: e.target.value }))}>
                    <option value="zxing">ZXing</option>
                    <option value="quagga">Quagga2</option>
                    <option value="hybrid">Hybrid (ZXing → Quagga)</option>
                </select>
            </label>

            <label>
                Preview:
                <select value={state.preview} onChange={e => setState(s => ({ ...s, preview: e.target.value }))}>
                    <option value="orig">Original</option>
                    <option value="gray">Grayscale</option>
                    <option value="processed">Processed</option>
                </select>
            </label>

            <label>
                Debug views
                <input type="checkbox" checked={state.debug} onChange={e => setState(s => ({ ...s, debug: e.target.checked }))} />
            </label>

            <label>
                Use ROI (center box)
                <input type="checkbox" checked={state.useROI} onChange={e => setState(s => ({ ...s, useROI: e.target.checked }))} />
            </label>

            <label>
                Median blur
                <input type="checkbox" checked={state.median} onChange={e => setState(s => ({ ...s, median: e.target.checked }))} />
            </label>

            <label>
                Adaptive threshold
                <input type="checkbox" checked={state.adaptive} onChange={e => setState(s => ({ ...s, adaptive: e.target.checked }))} />
            </label>

            <label>
                Sobel
                <input type="checkbox" checked={state.sobel} onChange={e => setState(s => ({ ...s, sobel: e.target.checked }))} />
            </label>

            <label>
                CLAHE (hist equalization)
                <input type="checkbox" checked={state.clahe} onChange={e => setState(s => ({ ...s, clahe: e.target.checked }))} />
            </label>

            <label>
                Unsharp (sharpen)
                <input type="checkbox" checked={state.unsharp} onChange={e => setState(s => ({ ...s, unsharp: e.target.checked }))} />
            </label>

            <label>
                Upload image
                <input type="file" accept="image/*" onChange={state.onFile} />
            </label>

            <button
                type="button"
                onClick={() => {
                    if (typeof state.onAutoFocus === 'function') state.onAutoFocus();
                }}
            >
                Try autofocus
            </button>
        </div>
    );
}
