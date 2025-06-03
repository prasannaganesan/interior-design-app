import * as ort from 'onnxruntime-web';
import { srgbToLinear } from '../color';

export interface IntrinsicResult {
  reflectance: Float32Array;
  shading: Float32Array;
  specular: Float32Array;
  width: number;
  height: number;
}

export class NIIDNet {
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

  async decompose(image: ImageData): Promise<IntrinsicResult> {
    if (!this.session) throw new Error('NIID-Net not initialized');
    const { width, height, data } = image;
    const input = new Float32Array(width * height * 3);
    for (let i = 0, p = 0; i < data.length; i += 4) {
      input[p++] = srgbToLinear(data[i]);
      input[p++] = srgbToLinear(data[i + 1]);
      input[p++] = srgbToLinear(data[i + 2]);
    }
    const tensor = new ort.Tensor('float32', input, [1, 3, height, width]);
    const outputs = await this.session.run({ image: tensor });
    const R = outputs['reflectance'] as ort.Tensor;
    const S = outputs['shading'] as ort.Tensor;
    const E = outputs['specular'] as ort.Tensor;
    return {
      reflectance: R.data as Float32Array,
      shading: S.data as Float32Array,
      specular: E.data as Float32Array,
      width,
      height
    };
  }
}
