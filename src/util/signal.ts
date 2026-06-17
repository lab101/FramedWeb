// Minimal typed signal, equivalent to the Cinder ci::signals::Signal used
// throughout the original app (onNewPoints, onReceivePoints, onErase, ...).
export class Signal<T extends unknown[]> {
  private handlers: Array<(...args: T) => void> = [];

  connect(handler: (...args: T) => void): () => void {
    this.handlers.push(handler);
    return () => {
      const i = this.handlers.indexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  emit(...args: T): void {
    // copy in case a handler disconnects during emit
    for (const h of this.handlers.slice()) h(...args);
  }
}
