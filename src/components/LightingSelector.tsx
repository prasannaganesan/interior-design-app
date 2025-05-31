
interface LightingSelectorProps {
  value: string;
  onChange: (mode: string) => void;
  className?: string;
}

export const LIGHTING_PRESETS = {
  normal: 'Normal',
  morning: 'Morning Sun',
  afternoon: 'Afternoon Sun',
  evening: 'Evening',
  night: 'Night Lights (LED)',
  cloudy: 'Cloudy Day'
};

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
