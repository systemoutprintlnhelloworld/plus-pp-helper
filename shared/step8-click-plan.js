export function decideStep8ClickPlan({
  nativeClicked = false,
  hasRect = false,
} = {}) {
  if (nativeClicked) {
    return hasRect ? 'native_then_debugger_fallback' : 'native_only';
  }
  return hasRect ? 'debugger_only' : 'no_click_available';
}
