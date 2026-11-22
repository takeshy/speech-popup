export function microphoneConstraints(deviceId) {
  const audio = deviceId ? { deviceId: { exact: deviceId } } : true;
  return { audio };
}
