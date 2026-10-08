// Tiny synchronous event bus.
//   const off = events.on('player:jump', (payload, name) => {...}); off();
//   events.once(name, fn); events.emit(name, payload);
//   events.on('*', (payload, name) => {...}) listens to every event (debug/logging).
// Listener arrays are copy-on-write, so listeners may subscribe/unsubscribe while
// an event is being dispatched without allocations on the emit hot path.
// A throwing listener is reported with console.error and does not stop the others.

export function createEvents() {
  const listeners = new Map(); // name -> frozen array of fns (replaced on change)

  function on(name, fn) {
    const prev = listeners.get(name);
    listeners.set(name, prev ? prev.concat(fn) : [fn]);
    return () => off(name, fn);
  }

  function off(name, fn) {
    const prev = listeners.get(name);
    if (!prev) return;
    const i = prev.indexOf(fn);
    if (i < 0) return;
    const next = prev.slice();
    next.splice(i, 1);
    if (next.length) listeners.set(name, next);
    else listeners.delete(name);
  }

  function once(name, fn) {
    const wrapped = (payload, n) => { off(name, wrapped); fn(payload, n); };
    return on(name, wrapped);
  }

  function dispatch(list, payload, name) {
    for (let i = 0; i < list.length; i++) {
      try { list[i](payload, name); }
      catch (err) { console.error(`[events] listener for "${name}" threw:`, err); }
    }
  }

  function emit(name, payload) {
    const list = listeners.get(name);
    if (list) dispatch(list, payload, name);
    const any = listeners.get('*');
    if (any) dispatch(any, payload, name);
  }

  function count(name) {
    const list = listeners.get(name);
    return list ? list.length : 0;
  }

  function clear() { listeners.clear(); }

  return { on, off, once, emit, count, clear };
}
