# Web engine models

The web engine uses PaddleOCR PP-OCRv6 small, published by PaddlePaddle under the Apache License 2.0
(<https://www.apache.org/licenses/LICENSE-2.0>).

| File | Source | Original `inference.onnx` sha256 |
| --- | --- | --- |
| `ppocrv6_small_det.onnx` | <https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx> | `d73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e` |
| `ppocrv6_small_rec.onnx` | <https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx> | `5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634` |
| `ppocrv6_small_rec_dict.txt` | `PostProcess.character_dict` in the recognition model's `inference.yml`, one character per line | |

## Changes

The ONNX files are modified: weight tensors with 256 or more values are stored as float16 and cast back to float32
when the model is loaded, which halves the file size. Every layer still computes in float32. The conversion is
`scripts/fp16-weights.py`:

```bash
pip install onnx numpy
python3 scripts/fp16-weights.py inference.onnx ppocrv6_small_det.onnx
```

`npm run build` (`scripts/embed-assets.mjs`) embeds these files into `dist/esm/web/assets/` as JavaScript modules.
