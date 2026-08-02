"use client";

import { useState } from "react";
import { CameraPane } from "./scan-tab";
import { PhoneLookupPane } from "./phone-tab";
import { ResultPanel } from "./result-panel";
import type { ScanOutcome } from "./actions";

/**
 * F1 one-screen merge (SPEC-WSB-F.md WS-F item 1): the old scan/phone tab
 * switch forced staff to leave the camera to use the phone fallback (or vice
 * versa). Both now live in one phone viewport (~667px budget): camera capped
 * at 42vh (spec: <=45vh) on top, phone entry directly beneath, scrollable if
 * a looked-up member's card runs long. Either path can produce a scan
 * outcome, so the result panel is lifted here and shared — whichever fires
 * last wins the panel, same as a single-tab screen would behave.
 */
export function ScanScreen({ slug, phonePrefix }: { slug: string; phonePrefix: string }) {
  const [result, setResult] = useState<ScanOutcome | null>(null);

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <CameraPane slug={slug} onResult={setResult} />
      <PhoneLookupPane slug={slug} phonePrefix={phonePrefix} onResult={setResult} />
      {result && <ResultPanel outcome={result} slug={slug} onDismiss={() => setResult(null)} />}
    </div>
  );
}
