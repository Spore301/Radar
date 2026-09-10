import React from "react";

// ---------------------------------------------------------------------------
// The RADR. wordmark as inline SVG. Paths are the glyph outlines from
// public/brand/radr-logo-*.svg, cropped to the ink bounds (1466.31 x 412.86) so
// the rendered box is the wordmark itself, not the 2000 x 1000 export canvas.
// Fill follows currentColor, so one component serves black and white uses.
// ---------------------------------------------------------------------------

interface RadrLogoProps {
  /** Rendered height in px; width follows the 3.552:1 aspect ratio. */
  height?: number;
  className?: string;
}

export function RadrLogo({ height = 27.5, className = "" }: RadrLogoProps) {
  const width = Math.round((height * 1466.31) / 412.86 * 100) / 100;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1466.31 412.86"
      width={width}
      height={height}
      fill="currentColor"
      role="img"
      aria-label="RADR."
      className={className}
    >
      <path transform="translate(-16.09 412.859)" d="M 326.203125 0 L 265.542969 -115.128906 L 326.203125 -115.128906 L 326.203125 -412.859375 L 16.09375 -412.859375 L 16.09375 0 L 119.464844 0 L 119.464844 -115.128906 L 164.03125 -115.128906 L 222.832031 0 Z M 222.832031 -209.214844 L 119.464844 -209.214844 L 119.464844 -318.15625 L 222.832031 -318.15625 Z M 222.832031 -209.214844" />
      <path transform="translate(326.19 412.859)" d="M 326.203125 0 L 326.203125 -412.859375 L 16.09375 -412.859375 L 16.09375 0 L 119.464844 0 L 119.464844 -115.128906 L 222.832031 -115.128906 L 222.832031 0 Z M 222.832031 -209.214844 L 119.464844 -209.214844 L 119.464844 -318.15625 L 222.832031 -318.15625 Z M 222.832031 -209.214844" />
      <path transform="translate(668.471 412.859)" d="M 320.011719 0 L 320.011719 -412.859375 L 9.902344 -412.859375 L 9.902344 -318.15625 L 30.332031 -318.15625 L 30.332031 -94.085938 L 9.902344 -94.085938 L 9.902344 0 Z M 216.644531 -94.085938 L 113.273438 -94.085938 L 113.273438 -318.15625 L 216.644531 -318.15625 Z M 216.644531 -94.085938" />
      <path transform="translate(1004.562 412.859)" d="M 326.203125 0 L 265.542969 -115.128906 L 326.203125 -115.128906 L 326.203125 -412.859375 L 16.09375 -412.859375 L 16.09375 0 L 119.464844 0 L 119.464844 -115.128906 L 164.03125 -115.128906 L 222.832031 0 Z M 222.832031 -209.214844 L 119.464844 -209.214844 L 119.464844 -318.15625 L 222.832031 -318.15625 Z M 222.832031 -209.214844" />
      <path transform="translate(1346.843 412.859)" d="M 119.464844 0 L 119.464844 -94.085938 L 16.09375 -94.085938 L 16.09375 0 Z M 119.464844 0" />
    </svg>
  );
}
