import { cn } from "@/lib/cn";
import { getSpecializationMedia } from "@/lib/wow-spec-media";
import type { WowClass } from "@/models/enums";

/** Square WoW specialization icon from cached Blizzard media file ids. */
export function SpecIcon({
  wowClass,
  specialization,
  size = 16,
  className,
}: {
  wowClass: WowClass;
  specialization: string;
  size?: number;
  className?: string;
}) {
  const media = getSpecializationMedia(wowClass, specialization);
  if (!media) {
    return (
      <span
        className={cn("inline-block shrink-0 rounded-sm bg-surface-raised", className)}
        style={{ width: size, height: size }}
        title={specialization}
        aria-label={specialization}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small external CDN asset; next/image not worth the remotePatterns churn
    <img
      src={media.iconSrc}
      alt={specialization}
      width={size}
      height={size}
      title={specialization}
      className={cn("inline-block shrink-0 rounded-sm", className)}
      style={{ width: size, height: size }}
      loading="lazy"
      decoding="async"
    />
  );
}
