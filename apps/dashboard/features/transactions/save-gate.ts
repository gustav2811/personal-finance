/** Navigation and autosave share one request rather than issuing competing writes. */
export function createSaveGate() {
  let running: Promise<boolean> | null = null
  return (save: () => Promise<boolean>): Promise<boolean> => {
    if (running) return running
    running = Promise.resolve().then(save).finally(() => { running = null })
    return running
  }
}
