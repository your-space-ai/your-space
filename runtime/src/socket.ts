/** Where the runtime manager listens, in the ys-runtime volume. */
export const SOCKET_PATH = process.env.YS_RUNTIME_SOCKET ?? "/run/ys-runtime/runtime.sock";
