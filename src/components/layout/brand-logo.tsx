import Image from "next/image";
import logo from "@/assets/manawyrm-logo.png";

/**
 * Round brand emblem used in the sidebar, mobile header and login screen.
 * Decorative: every placement renders the brand name as text next to it.
 */
export function BrandLogo({ size }: { size: number }) {
  return (
    <Image
      src={logo}
      alt=""
      width={size}
      height={size}
      priority
      className="shrink-0 rounded-full"
    />
  );
}
