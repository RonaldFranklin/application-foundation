"use client";
import { useEffect } from "react";
// Other tabs must discard previously rendered organizational data after a switch.
export default function ContextSync() {
  useEffect(() => {
    let selectingHere = false;
    const selecting = () => {
      selectingHere = true;
    };
    window.addEventListener("organization-context-selection", selecting);
    const channel = new BroadcastChannel("organization-context");
    channel.onmessage = () => {
      // Discard all rendered data and client caches from the previous context.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      if (!selectingHere) window.location.assign("/organizations");
    };
    return () => {
      channel.close();
      window.removeEventListener("organization-context-selection", selecting);
    };
  }, []);
  return null;
}
