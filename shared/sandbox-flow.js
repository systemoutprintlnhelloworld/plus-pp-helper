function getFirstIncompleteSandboxStep(stepStatuses = {}) {
  let highestCompletedStep = 0;

  for (let step = 1; step <= 7; step += 1) {
    if (stepStatuses[step] === 'completed' && step > highestCompletedStep) {
      highestCompletedStep = step;
    }
  }

  const nextStep = highestCompletedStep + 1;
  return nextStep > 7 ? null : nextStep;
}

async function runSandboxStepsFrom(startStep, actions = {}) {
  const {
    addLog = async () => {},
    checkAutoControl = async () => {},
    ensureMailBackendLogin = async () => {},
    getSandboxEmail,
    openSandboxLoginPage,
    executeSandboxStep,
    pollVerificationCode,
    fillLastCode,
    copySandboxSessionJson,
    submitSessionToPayUrl,
    completeCurrentAccount,
  } = actions;

  if (startStep <= 1) {
    await checkAutoControl();
    await ensureMailBackendLogin();
    await checkAutoControl();
    await getSandboxEmail();
  }

  if (startStep <= 2) {
    await checkAutoControl();
    await openSandboxLoginPage();
  }

  if (startStep <= 3) {
    await checkAutoControl();
    await executeSandboxStep(3);
  }

  if (startStep <= 4) {
    await checkAutoControl();
    await pollVerificationCode('signup');
    await checkAutoControl();
    await fillLastCode('signup');
  }

  if (startStep <= 5) {
    await checkAutoControl();
    await executeSandboxStep(5);
  }

  if (startStep <= 6) {
    await checkAutoControl();
    await copySandboxSessionJson();
  }

  if (startStep <= 7) {
    await checkAutoControl();
    await submitSessionToPayUrl();
  }

  await checkAutoControl();
  const result = await completeCurrentAccount();
  await addLog('Sandbox 流程完成，当前邮箱已标记为已使用');
  return result;
}

export async function runSandboxSessionFlow({ actions = {} } = {}) {
  const { addLog = async () => {} } = actions;
  await addLog('Sandbox 单轮流程开始');
  return runSandboxStepsFrom(1, actions);
}

export async function continueSandboxSessionFlow({ state = {}, actions = {} } = {}) {
  const { addLog = async () => {} } = actions;
  const startStep = getFirstIncompleteSandboxStep(state.stepStatuses || {});
  if (!startStep) {
    await addLog('当前 Sandbox 流程已全部完成，无需继续');
    return { status: 'completed', continuedFrom: null };
  }

  await addLog(`继续 Sandbox 流程：从步骤 ${startStep} 开始`);
  return runSandboxStepsFrom(startStep, actions);
}
