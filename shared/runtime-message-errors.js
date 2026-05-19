export function isMissingReceiverError(error) {
  const message = error?.message || String(error);
  return /Receiving end does not exist|message channel is closed|message channel closed before a response was received|indicated an asynchronous response|back\/forward cache|extension port/i.test(message);
}
