export function proctoringCutoff(
  now: number,
  deadline: number,
  lastCheckIn: number,
  recoveredOutages: number,
  checkIn: boolean,
) {
  const outageCutoff = lastCheckIn + (recoveredOutages >= 3 ? 15_000 : 60_001);
  const cutoff = Math.min(deadline, outageCutoff);
  if (now >= cutoff) {
    return {
      cutoff,
      recovered: false,
      disqualification: outageCutoff >= deadline
        ? null
        : recoveredOutages >= 3
          ? "Fourth connection interruption"
          : "Connection lost for more than 60 seconds",
    };
  }
  return {
    cutoff: null,
    recovered: checkIn && now - lastCheckIn >= 15_000,
    disqualification: null,
  };
}
