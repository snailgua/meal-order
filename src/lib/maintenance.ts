export function sheetWritesPaused(): boolean {
  return process.env.SHEETS_MAINTENANCE_MODE === "1";
}
