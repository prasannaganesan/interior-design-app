import * as ort from 'onnxruntime-web';

interface SAMModelConfig {
  encoderPath: string;
  decoderPath: string;
  modelSize: 'tiny' | 'base' | 'large';
  onStatus?: (msg: string) => void;
}

interface ImageEmbedding {
  high_res_feats_0: ort.Tensor;
  high_res_feats_1: ort.Tensor;
  image_embed: ort.Tensor;
}

export class SAM2 {
  private encoderSession: ort.InferenceSession | null = null;
  private decoderSession: ort.InferenceSession | null = null;
  private imageEmbedding: ImageEmbedding | null = null;
  private modelConfig: SAMModelConfig;
  private onStatus: (msg: string) => void;
  // Store original image size and preprocessing parameters
  private origWidth = 0;
  private origHeight = 0;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private static isInitialized = false;

  constructor(config: SAMModelConfig) {
    this.modelConfig = config;
    this.onStatus = config.onStatus ?? (() => {});
  }

  async initialize() {
    try {
      console.debug('Starting SAM2 initialization...');
      this.onStatus('Starting SAM2 initialization...');

      // Configure ONNX Runtime environment before creating any sessions
      if (!SAM2.isInitialized) {
        console.debug('Configuring ONNX Runtime environment...');
        this.onStatus('Configuring ONNX Runtime environment...');
        
        // Enable optimization features
        ort.env.wasm.simd = true;
        ort.env.wasm.numThreads = 4;

        // Configure WASM paths
        ort.env.wasm.wasmPaths = {
          'ort-wasm-simd-threaded.wasm': '/ort-wasm-simd-threaded.wasm',
          'ort-wasm-simd-threaded.jsep.wasm': '/ort-wasm-simd-threaded.jsep.wasm'
        };

        SAM2.isInitialized = true;
        console.debug('ONNX Runtime environment configured');
        this.onStatus('ONNX Runtime environment configured');
      }

      // Configure session options
      const options = {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      };

      // Initialize encoder
      console.debug('Loading encoder from:', this.modelConfig.encoderPath);
      this.onStatus('Loading encoder...');
      this.encoderSession = await ort.InferenceSession.create(
        this.modelConfig.encoderPath,
        options
      );
      console.debug('Encoder loaded successfully');
      this.onStatus('Encoder loaded');
      
      // Initialize decoder
      console.debug('Loading decoder from:', this.modelConfig.decoderPath);
      this.onStatus('Loading decoder...');
      this.decoderSession = await ort.InferenceSession.create(
        this.modelConfig.decoderPath,
        options
      );
      console.debug('Decoder loaded successfully');
      this.onStatus('Decoder loaded');
      
      console.debug('Successfully initialized SAM2');
      this.onStatus('SAM2 initialized');
    } catch (error) {
      console.error('Failed to initialize:', error);
      throw error;
    }
  }

  async generateEmbedding(imageData: ImageData) {
    if (!this.encoderSession) {
      throw new Error("SAM2 not initialized - encoder session is null");
    }

    try {
      console.debug('Preprocessing image...');
      this.onStatus('Preprocessing image...');
      const { tensor, scale, offsetX, offsetY } = await this.preprocessImage(imageData);

      // Store original size and preprocessing params
      this.origWidth = imageData.width;
      this.origHeight = imageData.height;
      this.scale = scale;
      this.offsetX = offsetX;
      this.offsetY = offsetY;
      
      console.debug('Running encoder...');
      this.onStatus('Running encoder...');
      const feeds = { image: tensor };
      const results = await this.encoderSession.run(feeds);

      if (!results) {
        throw new Error('Encoder failed to produce valid output');
      }

      this.imageEmbedding = {
        high_res_feats_0: results[this.encoderSession.outputNames[0]],
        high_res_feats_1: results[this.encoderSession.outputNames[1]],
        image_embed: results[this.encoderSession.outputNames[2]]
      };
      console.debug('Successfully generated embeddings');
      this.onStatus('Embeddings generated');
    } catch (error) {
      console.error('Error in generateEmbedding:', error);
      throw new Error(`Failed to generate embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async generateMask(point: { x: number, y: number }) {
    if (!this.decoderSession) {
      throw new Error("SAM2 not initialized - decoder session is null");
    }
    if (!this.imageEmbedding) {
      throw new Error("No image embeddings available - call generateEmbedding first");
    }

    try {
      console.debug('Preparing inputs for mask generation...');
      this.onStatus('Preparing inputs for mask generation...');
      // Prepare point input
      // Convert point to preprocessing coordinates
      const scaledX = point.x * this.scale + this.offsetX;
      const scaledY = point.y * this.scale + this.offsetY;
      const pointCoords = new ort.Tensor(
        "float32",
        [scaledX, scaledY],
        [1, 1, 2]
      );
      const pointLabels = new ort.Tensor("float32", [1], [1, 1]);

      // Prepare other required inputs
      const maskInput = new ort.Tensor(
        "float32",
        new Float32Array(256 * 256),
        [1, 1, 256, 256]
      );
      const hasMaskInput = new ort.Tensor("float32", [0], [1]);
      const origImSize = new ort.Tensor(
        "int32",
        [this.origHeight, this.origWidth],
        [2]
      );

      console.debug('Running decoder...');
      this.onStatus('Running decoder...');
      const feeds = {
        image_embed: this.imageEmbedding.image_embed,
        high_res_feats_0: this.imageEmbedding.high_res_feats_0,
        high_res_feats_1: this.imageEmbedding.high_res_feats_1,
        point_coords: pointCoords,
        point_labels: pointLabels,
        mask_input: maskInput,
        has_mask_input: hasMaskInput,
        orig_im_size: origImSize
      };

      const result = await this.decoderSession.run(feeds);

      if (!result.masks || !result.iou_predictions) {
        throw new Error('Decoder failed to produce valid output');
      }

      console.debug('Processing decoder output...');
      this.onStatus('Processing decoder output...');
      const masks = result.masks;
      const scores = result.iou_predictions.data;
      const bestMaskIdx = scores.indexOf(Math.max(...scores));

      const rawMask = this.postprocessMask(masks, bestMaskIdx);
      const restored = this.restoreMaskToOriginal(rawMask);
      return this.filterLargestComponent(restored);
    } catch (error) {
      console.error('Error in generateMask:', error);
      throw new Error(`Failed to generate mask: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async generateMasks(config: {
    positivePoints: { x: number; y: number }[];
    negativePoints?: { x: number; y: number }[];
    topK?: number;
  }) {
    if (!this.decoderSession) {
      throw new Error("SAM2 not initialized - decoder session is null");
    }
    if (!this.imageEmbedding) {
      throw new Error(
        "No image embeddings available - call generateEmbedding first"
      );
    }

    const neg = config.negativePoints ?? [];
    const points = [...config.positivePoints, ...neg];
    const labels = [
      ...config.positivePoints.map(() => 1),
      ...neg.map(() => 0)
    ];
    if (points.length === 0) {
      throw new Error("No points provided");
    }

    const coordsArr: number[] = [];
    for (const p of points) {
      const scaledX = p.x * this.scale + this.offsetX;
      const scaledY = p.y * this.scale + this.offsetY;
      coordsArr.push(scaledX, scaledY);
    }

    const pointCoords = new ort.Tensor(
      "float32",
      Float32Array.from(coordsArr),
      [1, points.length, 2]
    );
    const pointLabels = new ort.Tensor(
      "float32",
      Float32Array.from(labels),
      [1, labels.length]
    );

    const maskInput = new ort.Tensor(
      "float32",
      new Float32Array(256 * 256),
      [1, 1, 256, 256]
    );
    const hasMaskInput = new ort.Tensor("float32", [0], [1]);
    const origImSize = new ort.Tensor(
      "int32",
      [this.origHeight, this.origWidth],
      [2]
    );

    const feeds = {
      image_embed: this.imageEmbedding.image_embed,
      high_res_feats_0: this.imageEmbedding.high_res_feats_0,
      high_res_feats_1: this.imageEmbedding.high_res_feats_1,
      point_coords: pointCoords,
      point_labels: pointLabels,
      mask_input: maskInput,
      has_mask_input: hasMaskInput,
      orig_im_size: origImSize
    };

    const result = await this.decoderSession.run(feeds);

    if (!result.masks || !result.iou_predictions) {
      throw new Error("Decoder failed to produce valid output");
    }

    const masks = result.masks;
    const k = masks.dims[1];
    const num = Math.min(config.topK ?? k, k);
    const out: ImageData[] = [];
    for (let i = 0; i < num; i++) {
      const rawMask = this.postprocessMask(masks, i);
      const restored = this.restoreMaskToOriginal(rawMask);
      out.push(this.filterLargestComponent(restored));
    }
    return out;
  }

  private async preprocessImage(imageData: ImageData): Promise<{ tensor: ort.Tensor; scale: number; offsetX: number; offsetY: number }> {
    try {
      // Create a canvas to resize the image
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 1024;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Failed to get canvas context");

      // Draw and resize image
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = imageData.width;
      tempCanvas.height = imageData.height;
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) throw new Error("Failed to get temp canvas context");
      
      tempCtx.putImageData(imageData, 0, 0);
      
      // Maintain aspect ratio
      const scale = Math.min(1024 / imageData.width, 1024 / imageData.height);
      const scaledWidth = Math.round(imageData.width * scale);
      const scaledHeight = Math.round(imageData.height * scale);
      const dx = Math.floor((1024 - scaledWidth) / 2);
      const dy = Math.floor((1024 - scaledHeight) / 2);

      // Clear canvas and draw resized image
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 1024, 1024);
      ctx.drawImage(tempCanvas, dx, dy, scaledWidth, scaledHeight);

      // Convert to tensor format
      const imageDataResized = ctx.getImageData(0, 0, 1024, 1024);
      const redArray: number[] = [];
      const greenArray: number[] = [];
      const blueArray: number[] = [];
      
      for (let i = 0; i < imageDataResized.data.length; i += 4) {
        redArray.push(imageDataResized.data[i] / 255.0);
        greenArray.push(imageDataResized.data[i + 1] / 255.0);
        blueArray.push(imageDataResized.data[i + 2] / 255.0);
      }

      const float32Data = new Float32Array([...redArray, ...greenArray, ...blueArray]);
      const tensor = new ort.Tensor("float32", float32Data, [1, 3, 1024, 1024]);

      return { tensor, scale, offsetX: dx, offsetY: dy };
    } catch (error) {
      console.error('Error in preprocessImage:', error);
      throw new Error(`Failed to preprocess image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private postprocessMask(masks: ort.Tensor, maskIdx: number): ImageData {
    try {
      const [, , height, width] = masks.dims;
      const start = width * height * maskIdx;
      const end = start + width * height;
      const maskData = masks.data.slice(start, end);
      
      // Convert to RGBA
      const imageData = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < maskData.length; i++) {
        const idx = i * 4;
        const value = maskData[i] > 0 ? 255 : 0;
        imageData[idx] = value;     // R
        imageData[idx + 1] = 0;     // G
        imageData[idx + 2] = 0;     // B
        imageData[idx + 3] = value; // A
      }

      return new ImageData(imageData, width, height);
    } catch (error) {
      console.error('Error in postprocessMask:', error);
      throw new Error(`Failed to postprocess mask: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private restoreMaskToOriginal(mask: ImageData): ImageData {
    const maskScaleX = mask.width / 1024;
    const maskScaleY = mask.height / 1024;
    const cropX = Math.round(this.offsetX * maskScaleX);
    const cropY = Math.round(this.offsetY * maskScaleY);
    const cropW = Math.round(this.origWidth * this.scale * maskScaleX);
    const cropH = Math.round(this.origHeight * this.scale * maskScaleY);

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = mask.width;
    srcCanvas.height = mask.height;
    const srcCtx = srcCanvas.getContext('2d');
    if (!srcCtx) throw new Error('Failed to get canvas context');
    srcCtx.putImageData(mask, 0, 0);

    const dstCanvas = document.createElement('canvas');
    dstCanvas.width = this.origWidth;
    dstCanvas.height = this.origHeight;
    const dstCtx = dstCanvas.getContext('2d');
    if (!dstCtx) throw new Error('Failed to get canvas context');
    dstCtx.imageSmoothingEnabled = false;
    dstCtx.drawImage(
      srcCanvas,
      cropX,
      cropY,
      cropW,
      cropH,
      0,
      0,
      this.origWidth,
      this.origHeight
    );
    return dstCtx.getImageData(0, 0, this.origWidth, this.origHeight);
  }

  // Remove small disconnected regions and keep the largest component
  private filterLargestComponent(mask: ImageData): ImageData {
    const { width, height, data } = mask;
    const visited = new Uint8Array(width * height);
    let bestIndices: number[] = [];

    const getNeighbors = (idx: number) => {
      const x = idx % width;
      const y = Math.floor(idx / width);
      const neighbors: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            neighbors.push(ny * width + nx);
          }
        }
      }
      return neighbors;
    };

    for (let i = 0; i < width * height; i++) {
      if (data[i * 4] === 0 || visited[i]) continue;
      const queue: number[] = [i];
      visited[i] = 1;
      const indices: number[] = [i];
      while (queue.length) {
        const current = queue.pop() as number;
        for (const n of getNeighbors(current)) {
          if (data[n * 4] > 0 && !visited[n]) {
            visited[n] = 1;
            queue.push(n);
            indices.push(n);
          }
        }
      }
      if (indices.length > bestIndices.length) {
        bestIndices = indices;
      }
    }

    const out = new Uint8ClampedArray(width * height * 4);
    for (const idx of bestIndices) {
      const p = idx * 4;
      out[p] = 255;
      out[p + 1] = 0;
      out[p + 2] = 0;
      out[p + 3] = 255;
    }
    return new ImageData(out, width, height);
  }
}
