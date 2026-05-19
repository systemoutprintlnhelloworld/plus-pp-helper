export async function pollVerificationCodeWithResend({
  step,
  maxRounds = 3,
  addLog = async () => {},
  resendVerificationCode,
  pollVerificationCode,
} = {}) {
  if (typeof pollVerificationCode !== 'function') {
    throw new Error('缺少 pollVerificationCode 函数');
  }

  let minReceivedAt = '';
  let lastError = null;

  for (let round = 1; round <= Math.max(1, Number(maxRounds) || 1); round += 1) {
    try {
      await addLog(`步骤 ${step}：开始第 ${round}/${maxRounds} 轮验证码轮询。`, 'info');
      return await pollVerificationCode({ minReceivedAt, round });
    } catch (error) {
      lastError = error;
      await addLog(`步骤 ${step}：${error.message || String(error)}`, 'warn');

      if (round >= maxRounds) {
        break;
      }

      await addLog(`步骤 ${step}：将重新发送验证码后重试（${round + 1}/${maxRounds}）...`, 'warn');
      if (typeof resendVerificationCode === 'function') {
        minReceivedAt = await resendVerificationCode(step) || '';
        await addLog(`步骤 ${step}：已请求新的验证码，准备进入第 ${round + 1} 轮轮询。`, 'warn');
      }
    }
  }

  throw lastError || new Error(`步骤 ${step}：无法获取验证码`);
}
