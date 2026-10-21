"use client";

import { useEffect, useState } from "react";

/** Sends the browser's time zone so alerts arrive at sensible local times. */
export function TimeZoneField() {
  const [tz, setTz] = useState("");
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  return <input type="hidden" name="time_zone" value={tz} />;
}
