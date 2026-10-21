import { useId } from "react";
import Svg, { Circle, ClipPath, Defs, Path } from "react-native-svg";
import type { SvgPathIconProps } from "./svg-path-icon";

export function LinearIcon({ size = 16, color = "currentColor" }: SvgPathIconProps) {
  const clipId = useId();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Defs>
        <ClipPath id={clipId}>
          <Circle cx={12} cy={12} r={10} />
        </ClipPath>
      </Defs>
      <Path
        d="M-8 0 24 32M-4-4 28 28M0-8 32 24M-12 4 20 36M4-12 36 20M-16 8 16 40M8-16 40 16"
        stroke={color}
        strokeWidth={2.6}
        clipPath={`url(#${clipId})`}
      />
    </Svg>
  );
}
