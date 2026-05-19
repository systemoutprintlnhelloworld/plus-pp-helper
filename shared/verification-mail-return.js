function getMailReturnBehaviorAfterResend(mail = {}) {
  return {
    mode: mail.navigateOnReuse ? 'navigate' : 'activate',
    reloadIfSameUrl: Boolean(mail.reloadIfSameUrl),
  };
}

export {
  getMailReturnBehaviorAfterResend,
};
