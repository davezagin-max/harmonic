import { keyHue } from "@/lib/ui/colors";

/** A twelve-segment ring in the wheel's colours. */
export function Logo({ size = 26 }: { size?: number }) {
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const segment = circumference / 12;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {Array.from({ length: 12 }, (_, index) => (
        <circle
          key={index}
          cx={12}
          cy={12}
          r={radius}
          fill="none"
          stroke={`oklch(var(--key-l) var(--key-c) ${keyHue(index + 1)})`}
          strokeWidth={4.5}
          strokeDasharray={`${segment - 0.9} ${circumference - segment + 0.9}`}
          strokeDashoffset={-index * segment}
          transform="rotate(-75 12 12)"
        />
      ))}
    </svg>
  );
}
