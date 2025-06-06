
import { LIGHTING_PRESETS } from '../constants/lighting-presets';

interface LightingSelectorProps {
  value: string;
  onChange: (mode: string) => void;
  className?: string;
}
export default function LightingSelector({ value, onChange, className }: LightingSelectorProps) {
  return (
    <div className={`lighting-selector ${className ?? ''}`.trim()}>
      <h2>Lighting</h2>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(LIGHTING_PRESETS).map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>
    </div>
  );
}
