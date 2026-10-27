// jsdom has no layout: what assistant-ui's thread viewport observes and scrolls is stubbed here.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
if (typeof Element !== 'undefined') Element.prototype.scrollTo ??= function scrollTo() {};
