declare module 'onnxruntime-web' {
  export interface InferenceSession {
    run(feeds: { [key: string]: unknown }): Promise<{ [key: string]: Tensor }>;
    outputNames: string[];
  }

  export class Tensor {
    constructor(type: string, data: ArrayLike<number>, dims: number[]);
    data: Float32Array | Int32Array;
    dims: number[];
  }

  export const InferenceSession: {
    create(path: string, options?: { executionProviders?: string[] }): Promise<InferenceSession>;
  };

  export interface WasmConfig {
    wasmPaths: { [key: string]: string };
    numThreads?: number;
    simd?: boolean;
  }

  export interface OrtEnv {
    wasm: WasmConfig;
  }

  export const env: OrtEnv;

  // Both initialization methods are available depending on the version
  export function initializeWebAssembly(): Promise<void>;
  export function initWasm(): Promise<void>;
} 