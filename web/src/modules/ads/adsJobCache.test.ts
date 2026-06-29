import { describe, it, expect } from 'vitest';
import { adsJobCache, JobCache } from './adsJobCache';

describe('adsJobCache', () => {
  it('loading 상태에서는 null/빈 메시지로 기존 메시지를 지우지 않는다', async () => {
    const cache = new JobCache();
    const key = 'k-msg';

    // 상태를 로딩으로 만들기 위해 job을 시작한다.
    const p = cache.start(key, async ({ setMessage }) => {
      setMessage('데이터가 없어 자동 수집 중… 1/7');
      // 진행 중 메시지를 잠깐 비우는 상황을 시뮬레이션
      setMessage('');
      setMessage(null);
      await new Promise((r) => setTimeout(r, 10));
      return 1;
    });

    // job이 아직 진행 중인 시점에서 상태를 확인한다.
    const mid = cache.getState<any>(key);
    expect(mid.status).toBe('loading');
    expect(String(mid.message)).toContain('자동 수집 중');

    await p;
  });

  it('구독자가 해제되어도 job은 계속 진행되고, 완료 결과는 캐시에 남는다', async () => {
    const cache = new JobCache();
    const key = 'k1';

    let seen: any[] = [];
    const unsub = cache.subscribe(key, (s) => seen.push(s));

    const p = cache.start<number>(key, async ({ setMessage }) => {
      setMessage('working');
      await new Promise((r) => setTimeout(r, 20));
      return 123;
    });

    // 언마운트(구독 해제) 시뮬레이션
    unsub();
    await p;

    const state = cache.getState<number>(key);
    expect(state.status).toBe('success');
    expect(state.data).toBe(123);
  });

  it('동일 key로 start를 여러 번 호출해도 factory는 1회만 실행된다', async () => {
    const cache = new JobCache();
    const key = 'k2';
    let count = 0;

    const p1 = cache.start<number>(key, async () => {
      count += 1;
      await new Promise((r) => setTimeout(r, 10));
      return 7;
    });
    const p2 = cache.start<number>(key, async () => {
      count += 1;
      return 8;
    });

    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe(7);
    expect(b).toBe(7);
    expect(count).toBe(1);
  });

  it('cancel()은 진행 중인 job을 중단한다', async () => {
    const cache = new JobCache();
    const key = 'k-cancel';
    let started = false;

    const p = cache.start(key, async ({ setMessage, signal }) => {
      started = true;
      setMessage('수집 중… 1/7');
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })));
        setTimeout(resolve, 50);
      });
      return 1;
    });

    expect(started).toBe(true);
    cache.cancel(key);
    await expect(p).rejects.toBeTruthy();
    const st = cache.getState<any>(key);
    expect(st.status).toBe('error');
    expect(String(st.error)).toContain('중단');
  });

  it('loading 상태에서도 setData로 data를 갱신해 즉시 노출할 수 있다', async () => {
    const cache = new JobCache();
    const key = 'k-setdata';

    const p = cache.start<{ rows: number[] }>(key, async ({ setData, setMessage }) => {
      setMessage('loading…');
      setData({ rows: [1, 2, 3] });
      // 잠깐 대기(loading 유지)
      await new Promise((r) => setTimeout(r, 10));
      setData({ rows: [1, 2, 3, 4] });
      return { rows: [1, 2, 3, 4] };
    });

    const mid = cache.getState<any>(key);
    expect(mid.status).toBe('loading');
    expect(mid.data?.rows?.length).toBeGreaterThan(0);

    const done = await p;
    expect(done.rows.length).toBe(4);
    const st = cache.getState<any>(key);
    expect(st.status).toBe('success');
    expect(st.data?.rows?.length).toBe(4);
  });
});

