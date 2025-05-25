import * as ort from 'onnxruntime-web';

interface SAMModelConfig {
  encoderPath: string;
  decoderPath: string;
  modelSize: 'tiny' | 'base' | 'large';
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
  // Store original image size and preprocessing parameters
  private origWidth = 0;
  private origHeight = 0;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private static isInitialized = false;

  constructor(config: SAMModelConfig) {
    this.modelConfig = config;
  }

  async initialize() {
    try {
      console.log('Starting SAM2 initialization...');

      // Configure ONNX Runtime environment before creating any sessions
      if (!SAM2.isInitialized) {
        console.log('Configuring ONNX Runtime environment...');
        
        // Enable optimization features
        ort.env.wasm.simd = true;
        ort.env.wasm.numThreads = 4;

        // Configure WASM paths
        ort.env.wasm.wasmPaths = {
          'ort-wasm-simd-threaded.wasm': '/ort-wasm-simd-threaded.wasm',
          'ort-wasm-simd-threaded.jsep.wasm': '/ort-wasm-simd-threaded.jsep.wasm'
        };

        SAM2.isInitialized = true;
        console.log('ONNX Runtime environment configured');
      }

      // Configure session options
      const options = {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      };

      // Initialize encoder
      console.log('Loading encoder from:', this.modelConfig.encoderPath);
      this.encoderSession = await ort.InferenceSession.create(
        this.modelConfig.encoderPath,
        options
      );
      console.log('Encoder loaded successfully');
      
      // Initialize decoder
      console.log('Loading decoder from:', this.modelConfig.decoderPath);
      this.decoderSession = await ort.InferenceSession.create(
        this.modelConfig.decoderPath,
        options
      );
      console.log('Decoder loaded successfully');
      
      console.log('Successfully initialized SAM2');
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
      console.log('Preprocessing image...');
      const { tensor, scale, offsetX, offsetY } = await this.preprocessImage(imageData);

      // Store original size and preprocessing params
      this.origWidth = imageData.width;
      this.origHeight = imageData.height;
      this.scale = scale;
      this.offsetX = offsetX;
      this.offsetY = offsetY;
      
      console.log('Running encoder...');
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
      console.log('Successfully generated embeddings');
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
      console.log('Preparing inputs for mask generation...');
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

      console.log('Running decoder...');
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

      console.log('Processing decoder output...');
      const masks = result.masks;
      const scores = result.iou_predictions.data;
      const bestMaskIdx = scores.indexOf(Math.max(...scores));

      return this.postprocessMask(masks, bestMaskIdx);
    } catch (error) {
      console.error('Error in generateMask:', error);
      throw new Error(`Failed to generate mask: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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
} 