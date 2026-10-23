// Controller prototype -> the instance created by initializeApplication.
// Method decorators run on the prototype before any instance exists, so
// handlers look the instance up when a request arrives.
export const controllerInstances: WeakMap<object, unknown> = new WeakMap<object, unknown>();
