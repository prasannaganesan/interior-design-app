
interface LightingSelectorProps {
  value: string;
  onChange: (mode: string) => void;
}

export const LIGHTING_PRESETS = {
  normal: 'Normal',
  morning: 'Morning Sun',
  afternoon: 'Afternoon Sun',
  evening: 'Evening',
  night: 'Night Lights',
  cloudy: 'Cloudy Day'
};

export default function LightingSelector({ value, onChange }: LightingSelectorProps) {
  return (
    <div className="lighting-selector">
      <label>Lighting</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(LIGHTING_PRESETS).map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>
    </div>
  );
}
