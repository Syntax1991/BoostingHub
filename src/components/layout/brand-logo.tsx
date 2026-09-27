import Image from "next/image";
import logo from "@/assets/manawyrm-logo.png";
import { APP_BRAND_NAME } from "@/lib/branding";

/** Round brand emblem used in the sidebar and on the login screen. */
export function BrandLogo({ size }: { size: number }) {
  return (
    <Image
      src={logo}
      alt={`${APP_BRAND_NAME} logo`}
      width={size}
      height={size}
      priority
      className="shrink-0 rounded-full"
    />
  );
}
