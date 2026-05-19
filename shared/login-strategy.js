export function chooseStep6LoginPath({
  hasProfileSetupPage = false,
  hasOneTimeCodeTrigger = false,
  hasVerificationPage = false,
  hasConsentPage = false,
  hasPasswordInput = false,
} = {}) {
  if (hasProfileSetupPage) {
    return 'profile';
  }
  if (hasConsentPage) {
    return 'consent';
  }
  if (hasVerificationPage) {
    return 'otp';
  }
  if (hasOneTimeCodeTrigger) {
    return 'one_time_code';
  }
  if (hasPasswordInput) {
    return 'password';
  }
  return 'wait';
}

