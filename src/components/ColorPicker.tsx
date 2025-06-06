import { useState, useEffect, useRef } from 'react';

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  onChangeComplete?: (color: string) => void;
}

interface HSV {
  h: number;
  s: number;
  v: number;
}

const hexToHSV = (hex: string): HSV => {
  // Convert hex to RGB
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;

  let h = 0;
  if (diff === 0) {
    // Instead of setting h to 0, we'll keep the previous hue
    // This is handled by not modifying h, which will use the previous value
    // from the hsv state when converting back to hex
  } else if (max === r) {
    h = 60 * ((g - b) / diff);
  } else if (max === g) {
    h = 60 * (2 + (b - r) / diff);
  } else {
    h = 60 * (4 + (r - g) / diff);
  }

  if (h < 0) h += 360;

  const s = max === 0 ? 0 : diff / max;
  const v = max;

  return { h, s: s * 100, v: v * 100 };
};

const HSVToHex = (hsv: HSV): string => {
  const h = hsv.h;
  const s = hsv.s / 100;
  const v = hsv.v / 100;

  const hi = Math.floor(h / 60) % 6;
  const f = h / 60 - Math.floor(h / 60);
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  let r = 0, g = 0, b = 0;

  switch (hi) {
    case 0:
      r = v; g = t; b = p;
      break;
    case 1:
      r = q; g = v; b = p;
      break;
    case 2:
      r = p; g = v; b = t;
      break;
    case 3:
      r = p; g = q; b = v;
      break;
    case 4:
      r = t; g = p; b = v;
      break;
    case 5:
      r = v; g = p; b = q;
      break;
  }

  const toHex = (n: number) => {
    const hex = Math.round(n * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

interface RGB {
  r: number;
  g: number;
  b: number;
}

const hexToRGB = (hex: string): RGB => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16)
});

const rgbToHex = ({ r, g, b }: RGB): string => {
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

export default function ColorPicker({ value, onChange, onChangeComplete }: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hsv, setHSV] = useState<HSV>(hexToHSV(value));
  const [hexInput, setHexInput] = useState(value.toUpperCase());
  const [rgb, setRgb] = useState<RGB>(hexToRGB(value));
  const [supportsEyeDropper, setSupportsEyeDropper] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  // Notify parent when the user closes the picker
  useEffect(() => {
    if (wasOpen.current && !isOpen) {
      onChangeComplete?.(HSVToHex(hsv));
    }
    wasOpen.current = isOpen;
  }, [isOpen, hsv, onChangeComplete]);

  useEffect(() => {
    const newHSV = hexToHSV(value);
    // Preserve the hue when saturation is 0
    if (newHSV.s === 0) {
      newHSV.h = hsv.h;
    }
    setHSV(newHSV);
    setHexInput(value.toUpperCase());
    setRgb(hexToRGB(value));
  }, [value, hsv.h]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setSupportsEyeDropper('EyeDropper' in window);
  }, []);

  const handleSVChange = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));

    const newHSV = {
      ...hsv,
      s: x * 100,
      v: (1 - y) * 100
    };
    setHSV(newHSV);
    onChange(HSVToHex(newHSV));
  };

  const handleHueChange = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    
    const newHSV = {
      ...hsv,
      h: x * 360
    };
    setHSV(newHSV);
    onChange(HSVToHex(newHSV));
  };

  const handleSliderChange = (component: 'h' | 's' | 'v', value: number) => {
    const newHSV = { 
      ...hsv, 
      [component]: Math.max(0, Math.min(component === 'h' ? 360 : 100, value))
    };
    setHSV(newHSV);
    onChange(HSVToHex(newHSV));
  };

  const getGradientColor = (s: number) => {
    const color = HSVToHex({ h: hsv.h, s, v: hsv.v });
    return color;
  };

  const handleHexInputChange = (newValue: string) => {
    setHexInput(newValue);
    if (/^#[0-9A-Fa-f]{6}$/.test(newValue)) {
      onChange(newValue.toUpperCase());
    }
  };

  const handleRgbChange = (channel: keyof RGB, value: number) => {
    const newRgb = { ...rgb, [channel]: Math.max(0, Math.min(255, value)) };
    setRgb(newRgb);
    onChange(rgbToHex(newRgb));
  };

  const openEyeDropper = async () => {
    if (!supportsEyeDropper) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eyeDropper = new (window as any).EyeDropper();
      const result = await eyeDropper.open();
      onChange(result.sRGBHex);
    } catch {
      // ignore cancellation errors
    }
  };

  return (
    <div className="color-picker-container" ref={pickerRef}>
      <div 
        className="color-preview"
        style={{ backgroundColor: value }}
        onClick={() => setIsOpen(!isOpen)}
      />
      {isOpen && (
        <div
          className="color-picker-popup"
          onMouseDown={(e) => e.stopPropagation()}
          onMouseMove={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div 
            className="sv-picker"
            style={{ 
              backgroundColor: `hsl(${hsv.h}, 100%, 50%)`
            }}
            onClick={handleSVChange}
            onMouseDown={handleSVChange}
            onMouseMove={(e) => e.buttons === 1 && handleSVChange(e)}
          >
            <div 
              className="sv-picker-cursor"
              style={{
                left: `${hsv.s}%`,
                top: `${100 - hsv.v}%`,
                backgroundColor: value
              }}
            />
          </div>
          <div className="slider-controls">
            <div className="slider-control">
              <label>H</label>
              <div 
                className="hue-slider"
                onClick={handleHueChange}
                onMouseDown={handleHueChange}
                onMouseMove={(e) => e.buttons === 1 && handleHueChange(e)}
              >
                <div 
                  className="hue-slider-cursor"
                  style={{ left: `${(hsv.h / 360) * 100}%` }}
                />
              </div>
              <span>{Math.round(hsv.h)}°</span>
            </div>
            <div className="slider-control">
              <label>S</label>
              <div 
                className="saturation-slider"
                style={{
                  background: `linear-gradient(to right, 
                    ${getGradientColor(0)},
                    ${getGradientColor(100)}
                  )`
                }}
              >
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(hsv.s)}
                  onChange={(e) => handleSliderChange('s', Number(e.target.value))}
                />
              </div>
              <span>{Math.round(hsv.s)}%</span>
            </div>
            <div className="slider-control">
              <label>V</label>
              <div 
                className="value-slider"
                style={{
                  background: `linear-gradient(to right, 
                    ${HSVToHex({ ...hsv, v: 0 })},
                    ${HSVToHex({ ...hsv, v: 100 })}
                  )`
                }}
              >
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(hsv.v)}
                  onChange={(e) => handleSliderChange('v', Number(e.target.value))}
                />
              </div>
              <span>{Math.round(hsv.v)}%</span>
            </div>
          </div>
          <div className="color-info">
            <input
              type="text"
              value={hexInput}
              onChange={(e) => handleHexInputChange(e.target.value)}
            />
            <div className="rgb-inputs">
              <input
                type="number"
                min="0"
                max="255"
                value={rgb.r}
                onChange={(e) => handleRgbChange('r', Number(e.target.value))}
              />
              <input
                type="number"
                min="0"
                max="255"
                value={rgb.g}
                onChange={(e) => handleRgbChange('g', Number(e.target.value))}
              />
              <input
                type="number"
                min="0"
                max="255"
                value={rgb.b}
                onChange={(e) => handleRgbChange('b', Number(e.target.value))}
              />
            </div>
            {supportsEyeDropper && (
              <button className="eyedropper-button" onClick={openEyeDropper}>
                🎨
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}