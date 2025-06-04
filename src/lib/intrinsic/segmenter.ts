import * as ort from 'onnxruntime-web';
import { srgbToLinear } from '../color';

export class Segmenter {
  private session: ort.InferenceSession | null = null;
  private modelUrl: string;
  constructor(modelUrl: string) {
    this.modelUrl = modelUrl;
  }

  async initialize() {
    this.session = await ort.InferenceSession.create(this.modelUrl, {
      executionProviders: ['wasm']
    });
  }

  async segment(image: ImageData): Promise<Uint8Array> {
    if (!this.session) throw new Error('Segmenter not initialized');
    const { width, height, data } = image;
    const input = new Float32Array(width * height * 3);
    for (let i = 0, p = 0; i < data.length; i += 4) {
      input[p++] = srgbToLinear(data[i]);
      input[p++] = srgbToLinear(data[i + 1]);
      input[p++] = srgbToLinear(data[i + 2]);
    }
    const tensor = new ort.Tensor('float32', input, [1, 3, height, width]);
    const result = await this.session.run({ image: tensor });
    const out = result[this.session.outputNames[0]].data as Float32Array;
    // Assume the output is [1, num_classes, H, W]; take argmax per pixel
    const numClasses = this.session.outputNames.length;
    const labels = new Uint8Array(width * height);
    const stride = width * height;
    for (let c = 0; c < numClasses; c++) {
      const offset = c * stride;
      for (let i = 0; i < stride; i++) {
        const val = out[offset + i];
        if (c === 0 || val > out[labels[i] * stride + i]) {
          labels[i] = c as number;
        }
      }
    }
    return labels;
  }
}
