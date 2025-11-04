import Quagga from "@ericblade/quagga2";


export function decodeWithQuagga(canvas, onDetected, config = {}) {
    // We only enable Code 128 here (user requested Code-128 focus)
    const w = canvas.width;
    const h = canvas.height;
    const dataUrl = canvas.toDataURL('image/png');


    return new Promise((resolve, reject) => {
        Quagga.decodeSingle(
            {
                src: dataUrl,
                numOfWorkers: 0,
                inputStream: {
                    size: 800,
                },
                decoder: {
                    readers: ['code_128_reader']
                },
                locate: true,
                frequency: 10,
            },
            function (result) {
                if (result && result.codeResult) {
                    resolve(result.codeResult.code);
                } else {
                    reject(new Error('Not found'));
                }
            }
        );
    });
}