type DateFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

export default function DateField({
  label,
  value,
  onChange,
}: DateFieldProps) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        color: "#374151",
      }}
    >
      <span>{label}</span>

      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          height: 38,
          border: "1px solid #d1d5db",
          borderRadius: 999,
          padding: "0 12px",
          background: "#ffffff",
          color: "#111827",
          fontSize: 13,
          outline: "none",
        }}
      />
    </label>
  );
}