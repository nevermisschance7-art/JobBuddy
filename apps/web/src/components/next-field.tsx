/** Hidden field telling a save action where to go afterwards (onboarding). Omitted in Settings. */
export function NextField({ next }: { next?: string }) {
  return next ? <input type="hidden" name="next" value={next} /> : null;
}
