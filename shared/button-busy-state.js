export function setButtonBusyState(button, busy, loadingText = '处理中...') {
  if (!button) return;

  if (busy) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }
    button.dataset.busy = '1';
    button.disabled = true;
    button.classList.add('is-busy');
    button.textContent = loadingText;
    return;
  }

  button.dataset.busy = '0';
  button.disabled = false;
  button.classList.remove('is-busy');
  if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
  }
}

