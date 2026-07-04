import type { RuntimeAdapter } from "@zipship/runtime";

export interface ConsoleAppProps {
  runtime: RuntimeAdapter;
}

export function ConsoleApp({ runtime }: ConsoleAppProps) {
  return (
    <main>
      <h1>ZipShip</h1>
      <p>当前运行环境：{runtime.kind}</p>
    </main>
  );
}
