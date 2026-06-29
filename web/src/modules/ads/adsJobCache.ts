export type JobStatus = 'idle' | 'loading' | 'success' | 'error';

export type JobState<T> = {
  status: JobStatus;
  message: string | null;
  data: T | null;
  error: string | null;
};

type JobEntry<T> = {
  state: JobState<T>;
  promise: Promise<T> | null;
  abort: AbortController | null;
  startedAt: number; // epoch ms (for "latest running job" lookup)
  listeners: Set<(s: JobState<T>) => void>;
};

function initialState<T>(): JobState<T> {
  return { status: 'idle', message: null, data: null, error: null };
}

/** FastAPI 422 등 validation error의 detail(배열/객체)을 사람이 읽을 수 있는 문자열로 변환 */
function formatErrorDetail(detail: unknown): string {
  if (detail == null) return '데이터를 불러오지 못했습니다.';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { msg?: string; loc?: unknown[] } | undefined;
    return first?.msg ?? JSON.stringify(detail);
  }
  if (typeof detail === 'object' && detail !== null && 'msg' in detail) {
    return String((detail as { msg?: string }).msg ?? JSON.stringify(detail));
  }
  return String(detail);
}

export class JobCache {
  private jobs = new Map<string, JobEntry<any>>();

  getState<T>(key: string): JobState<T> {
    const e = this.jobs.get(key) as JobEntry<T> | undefined;
    return e?.state ?? initialState<T>();
  }

  subscribe<T>(key: string, listener: (s: JobState<T>) => void): () => void {
    let e = this.jobs.get(key) as JobEntry<T> | undefined;
    if (!e) {
      e = { state: initialState<T>(), promise: null, abort: null, startedAt: 0, listeners: new Set() };
      this.jobs.set(key, e);
    }
    e.listeners.add(listener as any);
    // 즉시 현재 상태 전달
    listener(e.state);
    return () => {
      const cur = this.jobs.get(key) as JobEntry<T> | undefined;
      if (!cur) return;
      cur.listeners.delete(listener as any);
    };
  }

  updateMessage(key: string, message: string | null): void {
    const e = this.jobs.get(key);
    if (!e) return;
    // UX: long-running job은 진행 중(status=loading)에도 message를 null/''로 잠깐 비울 수 있다.
    // 메뉴 이동 후 복귀했을 때 진행 표시(ProgressCard)가 사라져 보이지 않도록,
    // loading 상태에서는 null/빈 문자열로 기존 메시지를 덮어쓰지 않는다.
    const nextMsgRaw = message == null ? null : String(message);
    const prevMsgRaw = String((e.state as any)?.message ?? '');
    const isLoading = (e.state as any)?.status === 'loading';
    const isEmptyNext = nextMsgRaw == null || nextMsgRaw.trim().length === 0;
    const hasPrev = prevMsgRaw.trim().length > 0;
    const nextMsg = isLoading && hasPrev && isEmptyNext ? prevMsgRaw : nextMsgRaw;
    e.state = { ...(e.state as any), message: nextMsg };
    for (const fn of e.listeners) fn(e.state);
  }

  /** loading 상태에서도 data를 즉시 갱신해 UI가 "빈 화면"이 되지 않도록 한다. */
  updateData<T>(key: string, data: T | null): void {
    const e = this.jobs.get(key) as JobEntry<T> | undefined;
    if (!e) return;
    e.state = { ...(e.state as any), data: (data as any) ?? null };
    for (const fn of e.listeners) fn(e.state as any);
  }

  /**
   * 동일 key에 대해 job이 이미 진행 중이면 그 promise를 재사용한다.
   * component unmount와 무관하게 promise는 계속 진행되며, 완료 결과는 캐시에 남는다.
   */
  start<T>(
    key: string,
    factory: (helpers: { setMessage: (m: string | null) => void; setData: (d: T | null) => void; signal: AbortSignal }) => Promise<T>,
  ): Promise<T> {
    let e = this.jobs.get(key) as JobEntry<T> | undefined;
    if (!e) {
      e = { state: initialState<T>(), promise: null, abort: null, startedAt: 0, listeners: new Set() };
      this.jobs.set(key, e);
    }
    if (e.promise) return e.promise;
    if (e.abort) {
      try { e.abort.abort(); } catch { /* ignore */ }
    }
    e.abort = new AbortController();
    e.startedAt = Date.now();

    // UX: 새로고침/기간 변경 시 "빈 화면"이 보이지 않도록 이전 성공 데이터를 유지한 채 로딩 상태로 전환한다.
    const prevData = (e.state as any)?.data ?? null;
    e.state = { status: 'loading', message: null, data: prevData, error: null };
    for (const fn of e.listeners) fn(e.state);

    const setMessage = (m: string | null) => this.updateMessage(key, m);
    const setData = (d: T | null) => this.updateData<T>(key, d);
    const signal = e.abort.signal;
    e.promise = factory({ setMessage, setData, signal })
      .then((data) => {
        const cur = this.jobs.get(key) as JobEntry<T> | undefined;
        if (!cur) return data;
        cur.state = { status: 'success', message: null, data, error: null };
        cur.promise = null;
        cur.abort = null;
        for (const fn of cur.listeners) fn(cur.state);
        return data;
      })
      .catch((err) => {
        const isCanceled =
          (err as any)?.code === 'ERR_CANCELED' ||
          String((err as any)?.name ?? '').toLowerCase().includes('cancel') ||
          String((err as any)?.message ?? '').toLowerCase().includes('canceled');
        const msg = isCanceled
          ? '수집이 중단되었습니다.'
          : formatErrorDetail((err as any)?.response?.data?.detail ?? (err as any)?.message ?? '데이터를 불러오지 못했습니다.');
        const cur = this.jobs.get(key) as JobEntry<T> | undefined;
        if (cur) {
          // 에러가 나더라도 기존 데이터는 유지해 "비어 보이는" 문제를 피한다.
          const prev = (cur.state as any)?.data ?? null;
          cur.state = { status: 'error', message: null, data: prev, error: msg };
          cur.promise = null;
          cur.abort = null;
          for (const fn of cur.listeners) fn(cur.state);
        }
        throw err;
      });

    return e.promise;
  }

  /** prefix에 해당하는 "가장 최근 startedAt" loading jobKey를 찾는다(메뉴 복귀/기간 변경 시 pin 유지용). */
  findLatestLoadingKey(prefix: string): string | null {
    let bestKey: string | null = null;
    let bestTs = -1;
    for (const [k, e] of this.jobs.entries()) {
      if (!k.startsWith(prefix)) continue;
      if ((e.state as any)?.status !== 'loading') continue;
      const ts = Number((e as any)?.startedAt ?? 0) || 0;
      if (ts >= bestTs) {
        bestTs = ts;
        bestKey = k;
      }
    }
    return bestKey;
  }

  /** 진행 중인 job을 사용자 요청으로 중단한다(중단 버튼). */
  cancel(key: string): void {
    const e = this.jobs.get(key);
    if (!e) return;
    if (e.abort) {
      try { e.abort.abort(); } catch { /* ignore */ }
    }
  }

  /** 수동 갱신 등으로 결과를 지우고 싶을 때 사용 */
  invalidate(keyPrefix?: string): void {
    if (!keyPrefix) {
      this.jobs.clear();
      return;
    }
    for (const k of Array.from(this.jobs.keys())) {
      if (k.startsWith(keyPrefix)) this.jobs.delete(k);
    }
  }
}

export const adsJobCache = new JobCache();

