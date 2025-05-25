import { useEffect, useRef, useState } from 'react';
import { SAM2 } from '../lib/sam';
import { AVAILABLE_MODELS, getModelFiles } from '../lib/sam/model-loader';

interface ImageCanvasProps {
  imageUrl: string;
  selectedColor: string;
}

interface HistoryState {
  imageData: ImageData;
  timestamp: number;
}

interface Point {
  x: number;
  y: number;
}

interface Segment {
  id: string;
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
  avgColor: {
    r: number;
    g: number;
    b: number;
  };
  color: string | null;
  bitmap: Uint8Array;
}

interface WallSurface {
  id: string;
  pixels: Set<string>;
  color: string;
}

// Add utility functions for edge detection
const sobelOperator = (imageData: ImageData): Uint8Array => {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const edges = new Uint8Array(width * height);
  
  // Sobel kernels
  const kernelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const kernelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  
  // Convert to grayscale and calculate edges
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let pixelX = 0;
      let pixelY = 0;
      
      // Apply kernels
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * width + (x + kx)) * 4;
          // Convert to grayscale using luminance formula
          const gray = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
          pixelX += gray * kernelX[(ky + 1) * 3 + (kx + 1)];
          pixelY += gray * kernelY[(ky + 1) * 3 + (kx + 1)];
        }
      }
      
      // Calculate edge magnitude
      const magnitude = Math.sqrt(pixelX * pixelX + pixelY * pixelY);
      edges[y * width + x] = magnitude > 30 ? 255 : 0; // Threshold for edge detection
    }
  }
  
  return edges;
};

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
  const [segments, setSegments] = useState<Segment[]>([]);
  const [hoveredSegment, setHoveredSegment] = useState<string | null>(null);

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
      
      // Reset walls and segments when loading new image
      setWalls([]);
      setSelectedWall(null);
      setSegments([]);
      
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

  const performSegmentation = (imageData: ImageData): Segment[] => {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const visited = new Uint8Array(width * height);
    const segments: Segment[] = [];
    
    // Get edge information
    const edges = sobelOperator(imageData);
    
    // Parameters for segmentation
    const colorThreshold = 35;
    const minSegmentSize = 500;
    const edgeWeight = 2.0; // Weight factor for edge consideration
    
    // Helper function to get pixel color
    const getPixelColor = (x: number, y: number) => {
      const i = (y * width + x) * 4;
      return {
        r: data[i],
        g: data[i + 1],
        b: data[i + 2]
      };
    };
    
    // Enhanced color difference calculation that considers edges
    const colorDifference = (x1: number, y1: number, x2: number, y2: number) => {
      const c1 = getPixelColor(x1, y1);
      const c2 = getPixelColor(x2, y2);
      
      // Basic color difference
      const colorDiff = Math.sqrt(
        Math.pow(c1.r - c2.r, 2) +
        Math.pow(c1.g - c2.g, 2) +
        Math.pow(c1.b - c2.b, 2)
      );
      
      // Edge consideration
      const edgeFactor = (edges[y1 * width + x1] + edges[y2 * width + x2]) / 2;
      
      // Return weighted combination
      return colorDiff + edgeWeight * edgeFactor;
    };
    
    // Region growing algorithm with edge awareness
    const growRegion = (startX: number, startY: number): Segment | null => {
      const bitmap = new Uint8Array(Math.ceil(width * height / 8));
      const queue: Point[] = [];
      let pixelCount = 0;
      let sumR = 0, sumG = 0, sumB = 0;
      let minX = startX, maxX = startX, minY = startY, maxY = startY;
      
      queue.push({ x: startX, y: startY });
      
      const setBit = (x: number, y: number) => {
        const index = y * width + x;
        const byteIndex = Math.floor(index / 8);
        const bitIndex = index % 8;
        bitmap[byteIndex] |= (1 << bitIndex);
      };
      
      while (queue.length > 0) {
        const current = queue.shift()!;
        const index = current.y * width + current.x;
        
        if (visited[index] === 1) continue;
        
        // Check if we're on a strong edge
        if (edges[index] > 200) continue; // Skip strong edges
        
        // Use enhanced color difference
        if (colorDifference(startX, startY, current.x, current.y) > colorThreshold) continue;
        
        visited[index] = 1;
        setBit(current.x, current.y);
        pixelCount++;
        
        const currentColor = getPixelColor(current.x, current.y);
        sumR += currentColor.r;
        sumG += currentColor.g;
        sumB += currentColor.b;
        
        minX = Math.min(minX, current.x);
        maxX = Math.max(maxX, current.x);
        minY = Math.min(minY, current.y);
        maxY = Math.max(maxY, current.y);
        
        // Check neighbors (8-connected for better edge following)
        const neighbors = [
          { x: current.x + 1, y: current.y },
          { x: current.x - 1, y: current.y },
          { x: current.x, y: current.y + 1 },
          { x: current.x, y: current.y - 1 },
          { x: current.x + 1, y: current.y + 1 },
          { x: current.x - 1, y: current.y - 1 },
          { x: current.x + 1, y: current.y - 1 },
          { x: current.x - 1, y: current.y + 1 }
        ];
        
        for (const neighbor of neighbors) {
          if (
            neighbor.x >= 0 && neighbor.x < width &&
            neighbor.y >= 0 && neighbor.y < height &&
            visited[neighbor.y * width + neighbor.x] === 0
          ) {
            queue.push(neighbor);
          }
        }
      }
      
      if (pixelCount < minSegmentSize) return null;
      
      const avgColor = {
        r: Math.round(sumR / pixelCount),
        g: Math.round(sumG / pixelCount),
        b: Math.round(sumB / pixelCount)
      };
      
      return {
        id: `segment-${Date.now()}-${segments.length}`,
        bounds: { minX, maxX, minY, maxY },
        avgColor,
        color: null,
        bitmap
      };
    };

    // Perform segmentation
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (visited[y * width + x] === 0) {
          const segment = growRegion(x, y);
          if (segment) {
            segments.push(segment);
          }
        }
      }
    }

    // Modified mergeAdjacentSegments to be edge-aware
    const mergeAdjacentSegments = (segments: Segment[], threshold: number): Segment[] => {
      let merged = true;
      const result = [...segments];
      
      while (merged) {
        merged = false;
        
        for (let i = 0; i < result.length; i++) {
          for (let j = i + 1; j < result.length; j++) {
            const seg1 = result[i];
            const seg2 = result[j];
            
            // Check if segments are adjacent and similar in color
            if (areSegmentsAdjacent(seg1, seg2)) {
              // Count edge pixels along the boundary
              let edgePixelCount = 0;
              let boundaryPixelCount = 0;
              
              // Scan the boundary between segments
              for (let y = Math.max(seg1.bounds.minY, seg2.bounds.minY); 
                   y <= Math.min(seg1.bounds.maxY, seg2.bounds.maxY); y++) {
                for (let x = Math.max(seg1.bounds.minX, seg2.bounds.minX); 
                     x <= Math.min(seg1.bounds.maxX, seg2.bounds.maxX); x++) {
                  const index = y * width + x;
                  const byteIndex = Math.floor(index / 8);
                  const bitIndex = index % 8;
                  
                  const inSeg1 = (seg1.bitmap[byteIndex] & (1 << bitIndex)) !== 0;
                  const inSeg2 = (seg2.bitmap[byteIndex] & (1 << bitIndex)) !== 0;
                  
                  if ((inSeg1 && !inSeg2) || (!inSeg1 && inSeg2)) {
                    boundaryPixelCount++;
                    if (edges[index] > 100) { // Check for edge strength
                      edgePixelCount++;
                    }
                  }
                }
              }
              
              // Only merge if there aren't many edge pixels along the boundary
              const edgeRatio = edgePixelCount / (boundaryPixelCount || 1);
              if (edgeRatio < 0.2 && // Less than 20% edge pixels
                  colorDifference(
                    Math.floor((seg1.bounds.minX + seg1.bounds.maxX) / 2),
                    Math.floor((seg1.bounds.minY + seg1.bounds.maxY) / 2),
                    Math.floor((seg2.bounds.minX + seg2.bounds.maxX) / 2),
                    Math.floor((seg2.bounds.minY + seg2.bounds.maxY) / 2)
                  ) < threshold) {
                
                // Merge segments
                const mergedBitmap = new Uint8Array(seg1.bitmap.length);
                for (let k = 0; k < seg1.bitmap.length; k++) {
                  mergedBitmap[k] = seg1.bitmap[k] | seg2.bitmap[k];
                }
                
                const mergedSegment = {
                  id: seg1.id,
                  bounds: {
                    minX: Math.min(seg1.bounds.minX, seg2.bounds.minX),
                    maxX: Math.max(seg1.bounds.maxX, seg2.bounds.maxX),
                    minY: Math.min(seg1.bounds.minY, seg2.bounds.minY),
                    maxY: Math.max(seg1.bounds.maxY, seg2.bounds.maxY)
                  },
                  avgColor: {
                    r: Math.round((seg1.avgColor.r + seg2.avgColor.r) / 2),
                    g: Math.round((seg1.avgColor.g + seg2.avgColor.g) / 2),
                    b: Math.round((seg1.avgColor.b + seg2.avgColor.b) / 2)
                  },
                  color: seg1.color || seg2.color,
                  bitmap: mergedBitmap
                };
                
                result.splice(j, 1);
                result[i] = mergedSegment;
                merged = true;
                break;
              }
            }
          }
          if (merged) break;
        }
      }
      
      return result;
    };

    // Merge similar adjacent segments
    const mergedSegments = mergeAdjacentSegments(segments, colorThreshold * 1.5);
    return mergedSegments;
  };

  const areSegmentsAdjacent = (seg1: Segment, seg2: Segment): boolean => {
    // Check if bounding boxes overlap or are adjacent
    const horizontalOverlap = 
      seg1.bounds.minX <= seg2.bounds.maxX + 1 && 
      seg2.bounds.minX <= seg1.bounds.maxX + 1;
    
    const verticalOverlap = 
      seg1.bounds.minY <= seg2.bounds.maxY + 1 && 
      seg2.bounds.minY <= seg1.bounds.maxY + 1;
    
    if (!horizontalOverlap || !verticalOverlap) return false;
    
    // Check for actual pixel adjacency by scanning the boundary
    const width = Math.max(seg1.bounds.maxX, seg2.bounds.maxX) + 1;
    
    for (let y = Math.max(seg1.bounds.minY, seg2.bounds.minY); y <= Math.min(seg1.bounds.maxY, seg2.bounds.maxY); y++) {
      for (let x = Math.max(seg1.bounds.minX, seg2.bounds.minX); x <= Math.min(seg1.bounds.maxX, seg2.bounds.maxX); x++) {
        const index = y * width + x;
        const byteIndex = Math.floor(index / 8);
        const bitIndex = index % 8;
        
        const inSeg1 = (seg1.bitmap[byteIndex] & (1 << bitIndex)) !== 0;
        const inSeg2 = (seg2.bitmap[byteIndex] & (1 << bitIndex)) !== 0;
        
        if (inSeg1 && inSeg2) {
          return true;
        }
      }
    }
    
    return false;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      console.log('No canvas ref');
      return;
    }
    
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const x = Math.floor((e.clientX - rect.left) * scale);
    const y = Math.floor((e.clientY - rect.top) * scale);
    
    // Find segment under cursor
    const segment = segments.find(s => {
      if (x < s.bounds.minX || x > s.bounds.maxX || y < s.bounds.minY || y > s.bounds.maxY) {
        return false;
      }
      const index = y * canvas.width + x;
      const byteIndex = Math.floor(index / 8);
      const bitIndex = index % 8;
      return (s.bitmap[byteIndex] & (1 << bitIndex)) !== 0;
    });
    
    if (segment?.id !== hoveredSegment) {
      console.log(`Found segment at (${x},${y}):`, segment ? `id: ${segment.id}` : 'none');
      setHoveredSegment(segment?.id || null);
      highlightSegment(segment);
    }
  };

  const highlightSegment = (segment: Segment | undefined) => {
    const canvas = canvasRef.current;
    if (!canvas || !originalImageData) {
      console.log('Missing canvas or original image data');
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.log('No canvas context');
      return;
    }

    console.log('Highlighting segment:', segment ? segment.id : 'none');

    // Restore original image
    ctx.putImageData(originalImageData, 0, 0);

    // Draw all colored segments
    segments.forEach(s => {
      if (s.color) {
        drawSegment(ctx, s, s.color);
      }
    });

    // Highlight hovered segment
    if (segment && !segment.color) {
      const highlightColor = 'rgba(255, 255, 255, 0.3)';
      drawSegment(ctx, segment, highlightColor);
    }
  };

  const drawSegment = (ctx: CanvasRenderingContext2D, segment: Segment, color: string) => {
    const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    const data = imageData.data;

    // Parse color string to RGB
    let r, g, b, a;
    if (color.startsWith('#')) {
      r = parseInt(color.slice(1, 3), 16);
      g = parseInt(color.slice(3, 5), 16);
      b = parseInt(color.slice(5, 7), 16);
      a = 255;
    } else {
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (match) {
        [, r, g, b, a] = match.map(Number);
        a = a === undefined ? 255 : Math.round(a * 255);
      } else return;
    }

    // Only iterate over the bounded region
    for (let y = segment.bounds.minY; y <= segment.bounds.maxY; y++) {
      for (let x = segment.bounds.minX; x <= segment.bounds.maxX; x++) {
        const index = y * ctx.canvas.width + x;
        const byteIndex = Math.floor(index / 8);
        const bitIndex = index % 8;
        
        if ((segment.bitmap[byteIndex] & (1 << bitIndex)) !== 0) {
          const i = index * 4;
          if (a === 255) {
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
          } else {
            // Alpha blending
            data[i] = Math.round((r * a + data[i] * (255 - a)) / 255);
            data[i + 1] = Math.round((g * a + data[i + 1] * (255 - a)) / 255);
            data[i + 2] = Math.round((b * a + data[i + 2] * (255 - a)) / 255);
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
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
      const scale = canvas.width / rect.width;
      const x = Math.floor((e.clientX - rect.left) * scale);
      const y = Math.floor((e.clientY - rect.top) * scale);

      // Generate mask for clicked point
      const mask = await sam.generateMask({ x, y });

      // Apply the mask with selected color
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Convert hex to RGB
      const r = parseInt(selectedColor.slice(1, 3), 16);
      const g = parseInt(selectedColor.slice(3, 5), 16);
      const b = parseInt(selectedColor.slice(5, 7), 16);

      // Scale mask to canvas size if needed
      const scaledMask = scaleImageData(mask, canvas.width, canvas.height);
      const maskData = scaledMask.data;

      // Apply color where mask is non-zero
      for (let i = 0; i < data.length; i += 4) {
        if (maskData[i] > 0) {
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
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

    // Convert hex to RGB
    const r = parseInt(newColor.slice(1, 3), 16);
    const g = parseInt(newColor.slice(3, 5), 16);
    const b = parseInt(newColor.slice(5, 7), 16);

    // Update all pixels in the wall
    for (const pixelKey of wall.pixels) {
      const [x, y] = pixelKey.split(',').map(Number);
      const i = (y * canvas.width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
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
    setSegments(segments.map(s => ({ ...s, color: null })));
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