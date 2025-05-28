import { useEffect, useRef, useState } from 'react';
import { SAM2 } from '../lib/sam';
import { AVAILABLE_MODELS, getModelFiles } from '../lib/sam/model-loader';

// Utility functions to convert between RGB and HSL. These are used to
// preserve the original luminance of the surface when applying a new color.
const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0; let s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h * 360, s, l];
};

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  h /= 360;
  let r: number; let g: number; let b: number;
  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
};

interface ImageCanvasProps {
  imageUrl: string;
  selectedColor: string;
}

interface HistoryState {
  imageData: ImageData;
  timestamp: number;
}


interface WallSurface {
  id: string;
  pixels: Set<string>;
  color: string;
}


export default function ImageCanvas({ imageUrl, selectedColor }: ImageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [originalImageData, setOriginalImageData] = useState<ImageData | null>(null);
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1);
  const [sam, setSam] = useState<SAM2 | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [walls, setWalls] = useState<WallSurface[]>([]);
  const [selectedWall, setSelectedWall] = useState<string | null>(null);

  // Initialize SAM2
  useEffect(() => {
    async function initSAM() {
      try {
        setStatus('Initializing SAM2...');
        // Start with tiny model for faster loading
        const modelInfo = AVAILABLE_MODELS[0];
        const { encoderPath, decoderPath } = await getModelFiles(modelInfo);
        
        const samInstance = new SAM2({
          encoderPath,
          decoderPath,
          modelSize: modelInfo.size
        });
        
        await samInstance.initialize();
        setSam(samInstance);
        setStatus('SAM2 initialized');
      } catch (error) {
        console.error('Failed to initialize SAM2:', error);
        setStatus('Failed to initialize SAM2');
      }
    }

    initSAM();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const image = new Image();
    image.src = imageUrl;
    image.onload = async () => {
      // Set canvas size to match image
      canvas.width = image.width;
      canvas.height = image.height;
      
      // Draw image
      ctx.drawImage(image, 0, 0);
      
      // Store original image data
      const initialImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setOriginalImageData(initialImageData);
      
      // Initialize history with original image
      setHistory([{ imageData: initialImageData, timestamp: Date.now() }]);
      setCurrentHistoryIndex(0);
      
      // Reset walls when loading new image
      setWalls([]);
      setSelectedWall(null);
      
      // Generate embeddings for SAM
      if (sam) {
        try {
          setStatus('Generating image embeddings...');
          setIsProcessing(true);
          await sam.generateEmbedding(initialImageData);
          setStatus('Ready');
        } catch (error) {
          console.error('Failed to generate embeddings:', error);
          setStatus('Failed to generate embeddings');
        } finally {
          setIsProcessing(false);
        }
      }
    };
  }, [imageUrl, sam]);

  useEffect(() => {
    // Update wall color when selected color changes and a wall is selected
    if (selectedWall && selectedColor) {
      const wall = walls.find(w => w.id === selectedWall);
      if (wall) {
        recolorWall(wall, selectedColor);
      }
    }
  }, [selectedColor, selectedWall]);


  const hoverTimer = useRef<number | null>(null);

  // Analyze connected regions in a mask for debugging purposes
  const analyzeMask = (mask: ImageData) => {
    const { width, height, data } = mask;
    const visited = new Uint8Array(width * height);
    const regions: { xMin: number; yMin: number; xMax: number; yMax: number; size: number }[] = [];
    const queue: [number, number][] = [];
    const idx = (x: number, y: number) => (y * width + x) * 4;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const flat = y * width + x;
        if (data[idx(x, y)] > 0 && !visited[flat]) {
          let xMin = x;
          let xMax = x;
          let yMin = y;
          let yMax = y;
          let size = 0;
          queue.push([x, y]);
          visited[flat] = 1;

          while (queue.length) {
            const [qx, qy] = queue.pop()!;
            size++;
            xMin = Math.min(xMin, qx);
            xMax = Math.max(xMax, qx);
            yMin = Math.min(yMin, qy);
            yMax = Math.max(yMax, qy);

            const neighbors = [
              [qx - 1, qy],
              [qx + 1, qy],
              [qx, qy - 1],
              [qx, qy + 1]
            ];
            for (const [nx, ny] of neighbors) {
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const nFlat = ny * width + nx;
                if (!visited[nFlat] && data[idx(nx, ny)] > 0) {
                  visited[nFlat] = 1;
                  queue.push([nx, ny]);
                }
              }
            }
          }

          regions.push({ xMin, yMin, xMax, yMax, size });
        }
      }
    }

    return regions;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !sam) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.round(e.nativeEvent.offsetX * scaleX);
    const y = Math.round(e.nativeEvent.offsetY * scaleY);
    const clampedX = Math.min(Math.max(x, 0), canvas.width - 1);
    const clampedY = Math.min(Math.max(y, 0), canvas.height - 1);

    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
    }

    hoverTimer.current = window.setTimeout(async () => {
      try {
        const mask = await sam.generateMask({ x: clampedX, y: clampedY });
        showHoverMask(mask);
      } catch (err) {
        console.error('Failed to generate hover mask', err);
      }
    }, 150);
  };

  const showHoverMask = (mask: ImageData) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const base = history[currentHistoryIndex]?.imageData;
    if (!base) return;

    ctx.putImageData(base, 0, 0);
    const scaledMask =
      mask.width === canvas.width && mask.height === canvas.height
        ? mask
        : scaleImageData(mask, canvas.width, canvas.height);

    console.log('Hover mask regions', analyzeMask(scaledMask));
    const overlay = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = overlay.data;
    const maskData = scaledMask.data;

    for (let i = 0; i < data.length; i += 4) {
      if (maskData[i] > 0) {
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = 128;
      }
    }

    ctx.putImageData(overlay, 0, 0);
  };

  const clearHover = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const base = history[currentHistoryIndex]?.imageData;
    if (base) ctx.putImageData(base, 0, 0);
  };

  const handleMouseDown = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!sam || isProcessing) return;

    const canvas = canvasRef.current;
    if (!canvas || !originalImageData) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsProcessing(true);
    setStatus('Generating mask...');

    try {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = Math.round(e.nativeEvent.offsetX * scaleX);
      const y = Math.round(e.nativeEvent.offsetY * scaleY);

      const clampedX = Math.min(Math.max(x, 0), canvas.width - 1);
      const clampedY = Math.min(Math.max(y, 0), canvas.height - 1);

      // Generate mask for clicked point
      const mask = await sam.generateMask({ x: clampedX, y: clampedY });
      console.log('Raw mask regions', analyzeMask(mask));

      // Apply the mask with selected color. We keep the luminance from the
      // original image to preserve shadows and highlights for a more
      // photo-realistic effect.
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      if (!originalImageData) return;
      const origData = originalImageData.data;

      // Convert hex to RGB and then to HSL for easier luminance manipulation
      const r = parseInt(selectedColor.slice(1, 3), 16);
      const g = parseInt(selectedColor.slice(3, 5), 16);
      const b = parseInt(selectedColor.slice(5, 7), 16);
      const [h, s] = rgbToHsl(r, g, b);

      // Scale mask to canvas size if needed
      const scaledMask =
        mask.width === canvas.width && mask.height === canvas.height
          ? mask
          : scaleImageData(mask, canvas.width, canvas.height);
      console.log('Scaled mask regions', analyzeMask(scaledMask));
      const maskData = scaledMask.data;

      // Apply color where mask is non-zero while keeping original luminance
      for (let i = 0; i < data.length; i += 4) {
        if (maskData[i] > 0) {
          const [ , , l] = rgbToHsl(origData[i], origData[i + 1], origData[i + 2]);
          const [nr, ng, nb] = hslToRgb(h, s, l);
          data[i] = nr;
          data[i + 1] = ng;
          data[i + 2] = nb;
        }
      }

      ctx.putImageData(imageData, 0, 0);

      // Save to history
      const newHistory = history.slice(0, currentHistoryIndex + 1);
      newHistory.push({
        imageData: imageData,
        timestamp: Date.now()
      });

      if (newHistory.length > 20) {
        newHistory.shift();
      }

      setHistory(newHistory);
      setCurrentHistoryIndex(newHistory.length - 1);
      setStatus('Ready');
    } catch (error) {
      console.error('Failed to generate/apply mask:', error);
      setStatus('Failed to generate mask');
    } finally {
      setIsProcessing(false);
    }
  };

  const scaleImageData = (source: ImageData, targetWidth: number, targetHeight: number): ImageData => {
    if (source.width === targetWidth && source.height === targetHeight) {
      return source;
    }
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');

    // Draw source image data
    ctx.putImageData(source, 0, 0);

    // Create a temporary canvas for scaling
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = targetWidth;
    tempCanvas.height = targetHeight;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) throw new Error('Failed to get temp canvas context');

    // Disable smoothing for crisp mask edges
    tempCtx.imageSmoothingEnabled = false;

    // Scale the image
    tempCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight);
    return tempCtx.getImageData(0, 0, targetWidth, targetHeight);
  };

  const recolorWall = (wall: WallSurface, newColor: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    if (!originalImageData) return;
    const origData = originalImageData.data;

    // Convert hex to RGB
    const r = parseInt(newColor.slice(1, 3), 16);
    const g = parseInt(newColor.slice(3, 5), 16);
    const b = parseInt(newColor.slice(5, 7), 16);
    const [h, s] = rgbToHsl(r, g, b);

    // Update all pixels in the wall
    for (const pixelKey of wall.pixels) {
      const [x, y] = pixelKey.split(',').map(Number);
      const i = (y * canvas.width + x) * 4;
      const [ , , l] = rgbToHsl(origData[i], origData[i + 1], origData[i + 2]);
      const [nr, ng, nb] = hslToRgb(h, s, l);
      data[i] = nr;
      data[i + 1] = ng;
      data[i + 2] = nb;
    }

    ctx.putImageData(imageData, 0, 0);
    wall.color = newColor;

    // Update walls array
    setWalls(walls.map(w => w.id === wall.id ? wall : w));
    saveToHistory();
  };

  const saveToHistory = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Remove any redo states
    const newHistory = history.slice(0, currentHistoryIndex + 1);
    newHistory.push({
      imageData: currentImageData,
      timestamp: Date.now()
    });

    // Limit history size to prevent memory issues
    if (newHistory.length > 20) {
      newHistory.shift();
    }

    setHistory(newHistory);
    setCurrentHistoryIndex(newHistory.length - 1);
  };

  const undo = () => {
    if (currentHistoryIndex > 0) {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const newIndex = currentHistoryIndex - 1;
      ctx.putImageData(history[newIndex].imageData, 0, 0);
      setCurrentHistoryIndex(newIndex);
    }
  };

  const redo = () => {
    if (currentHistoryIndex < history.length - 1) {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const newIndex = currentHistoryIndex + 1;
      ctx.putImageData(history[newIndex].imageData, 0, 0);
      setCurrentHistoryIndex(newIndex);
    }
  };

  const reset = () => {
    const canvas = canvasRef.current;
    if (!canvas || !originalImageData) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.putImageData(originalImageData, 0, 0);
    setHistory([{ imageData: originalImageData, timestamp: Date.now() }]);
    setCurrentHistoryIndex(0);
    setWalls([]);
    setSelectedWall(null);
  };

  return (
    <div className="canvas-wrapper">
      <div className="canvas-controls">
        <button onClick={undo} disabled={currentHistoryIndex <= 0 || isProcessing}>Undo</button>
        <button onClick={redo} disabled={currentHistoryIndex >= history.length - 1 || isProcessing}>Redo</button>
        <button onClick={reset} disabled={isProcessing}>Reset</button>
        {selectedWall && (
          <button onClick={() => setSelectedWall(null)}>Deselect Wall</button>
        )}
        <span className="status">{status}</span>
      </div>
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={clearHover}
        style={{
          maxWidth: '100%',
          height: 'auto',
          cursor: isProcessing ? 'wait' : 'pointer',
          border: '1px solid #ccc'
        }}
      />
    </div>
  );
} 