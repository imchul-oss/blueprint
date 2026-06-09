import { watch, type FSWatcher } from "node:fs";
import { loadPolicy, type ProjectPolicy } from "./policy.js";

/**
 * BLUEPRINT.md 변경을 감시해 ProjectPolicy 를 핫리로드한다.
 * fs.watch 는 OS·파일시스템에 따라 중복 이벤트가 날 수 있어 디바운스(200ms)를 둔다.
 *
 * 사용 예:
 *   const pw = new PolicyWatcher("./BLUEPRINT.md", (p) => { currentPolicy = p; });
 *   pw.start();
 *   ...
 *   pw.stop();
 */
export class PolicyWatcher {
  private watcher?: FSWatcher;
  private debounce?: NodeJS.Timeout;
  private current: ProjectPolicy;

  constructor(
    private path: string,
    private onChange: (next: ProjectPolicy) => void,
    private debounceMs = 200,
  ) {
    this.current = loadPolicy(path);
  }

  /** 최초 로드 결과(서버 부팅 시 즉시 사용). */
  initial(): ProjectPolicy {
    return this.current;
  }

  start(): void {
    try {
      this.watcher = watch(this.path, { persistent: false }, () => this.schedule());
    } catch (e) {
      console.error(`[ubp] policy-watcher 시작 실패: ${(e as Error).message}`);
    }
  }

  stop(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.watcher?.close();
    this.watcher = undefined;
  }

  private schedule(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      try {
        const next = loadPolicy(this.path);
        this.current = next;
        this.onChange(next);
      } catch (e) {
        console.error(`[ubp] policy 재로드 실패: ${(e as Error).message}`);
      }
    }, this.debounceMs);
  }
}
