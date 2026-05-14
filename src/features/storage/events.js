export function createRuntimeEventHub() {
  let version = 0;
  const subscribers = new Set();

  return {
    get version() {
      return version;
    },
    emit(change) {
      version += 1;
      const event = {
        version,
        timestamp: new Date().toISOString(),
        ...change,
      };
      for (const subscriber of subscribers) {
        subscriber(event);
      }
      return event;
    },
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
    close() {
      subscribers.clear();
    },
  };
}
