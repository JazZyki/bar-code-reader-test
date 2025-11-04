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
                Upload image
                <input type="file" accept="image/*" onChange={state.onFile} />
            </label>
        </div>
    );
}