import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { idbGet, idbSet } from './idbKv';

export type CategoryEntry = {
  id: string;
  path: string;
  // localStorage 용량을 아끼기 위해 저장 시에는 segments를 제외한다(런타임에서 계산).
  segments?: string[];
  savedAt: string;
  sourceFilename?: string | null;
  updatedAt?: string | null;
};

export type CategoryValue = { id: string; path: string } | null;

type CategoryDictMeta = {
  filename: string;
  savedAt: string;
  parsedRows: number;
};

type CategoryDictionaryApiItem = {
  id: string;
  path: string;
  source_filename?: string | null;
  saved_at?: string | null;
  updated_at?: string | null;
};

type CategoryDictionaryApiResponse = {
  items?: CategoryDictionaryApiItem[];
  total?: number;
  active_batch_id?: string | null;
  latest_upload?: {
    filename?: string | null;
    parsed_rows?: number | null;
    saved_at?: string | null;
  } | null;
  files?: Array<{
    batch_id: string;
    filename: string;
    parsed_rows: number;
    uploaded_at?: string | null;
    applied_at?: string | null;
    is_active?: boolean;
  }>;
};

type CategoryDictionaryImportResponse = {
  parsed: number;
  inserted: number;
  skipped: number;
  total_active: number;
  saved_at?: string | null;
  filename?: string | null;
  batch_id?: string | null;
};

type CategoryDictionaryFileItem = {
  batchId: string;
  filename: string;
  parsedRows: number;
  uploadedAt: string | null;
  appliedAt: string | null;
  isActive: boolean;
};

function safeJsonParse<T>(s: string | null, fallback: T): T {
  try {
    if (!s) return fallback;
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function normalizeForSearch(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[\s>/]/g, '');
}

function normalizePathToSegments(path: string): string[] {
  const raw = (path || '').trim();
  if (!raw) return [];
  // 지원: "A/B/C", "A>B>C", "A>B>C>D"
  const parts = raw
    .split(/[>/]/g)
    .map((x) => x.trim())
    .filter(Boolean);
  return parts;
}

function segmentsToPath(segs: string[]): string {
  return segs.filter(Boolean).join('>');
}

function withSegments(e: CategoryEntry): CategoryEntry {
  const segs = e.segments && e.segments.length > 0 ? e.segments : normalizePathToSegments(e.path);
  return { ...e, segments: segs };
}

function formatDateTimeLabel(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  const ss = String(dt.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function serializeEntries(entries: CategoryEntry[]): Array<{ id: string; path: string; savedAt: string }> {
  // segments는 저장하지 않는다(필요 시 계산)
  return entries.map((e) => ({ id: e.id, path: e.path, savedAt: e.savedAt }));
}

function safeLocalStorageSet(key: string, value: string): { ok: boolean; error?: string } {
  try {
    localStorage.setItem(key, value);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e || 'localStorage 저장 실패') };
  }
}

function decodeBestEffort(buf: ArrayBuffer): { text: string; encoding: string } {
  const candidates = ['utf-8', 'euc-kr', 'windows-949'] as const;
  const decoded = candidates.map((enc) => {
    try {
      const td = new TextDecoder(enc, { fatal: false });
      const text = td.decode(new Uint8Array(buf));
      const bad = (text.match(/�/g) || []).length;
      // 한글(가-힣) 비율이 높을수록 좋게 평가(깨진 문자열은 한글이 거의 없음)
      const hangul = (text.match(/[가-힣]/g) || []).length;
      return { enc, text, score: hangul * 10 - bad * 50 };
    } catch {
      return { enc, text: '', score: Number.NEGATIVE_INFINITY };
    }
  });
  decoded.sort((a, b) => b.score - a.score);
  return { text: decoded[0]?.text || '', encoding: decoded[0]?.enc || 'utf-8' };
}

function parseCategoryCsv(text: string): { rows: Array<{ id: string; path: string }>; error?: string } {
  const lines = (text || '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], error: 'CSV 내용이 비어있습니다.' };

  // 헤더가 있더라도 위치 기반 파싱(1열: id, 2~5열: 분류 텍스트)
  const out: Array<{ id: string; path: string }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    // 쉼표 CSV(따옴표는 거의 없다고 가정, 있으면 간단히 제거)
    const cols = line
      .split(',')
      .map((c) => c.replace(/^"|"$/g, '').trim());
    if (cols.length < 2) continue;
    const id = cols[0];
    if (!id) continue;
    // header skip
    if (i === 0 && !/^\d+$/.test(id)) continue;
    if (!/^\d+$/.test(id)) continue;
    const segs = cols
      .slice(1, 5)
      .filter((x): x is string => Boolean(x) && x !== '-' && x.toLowerCase() !== 'null');
    if (segs.length < 2) continue;
    out.push({ id, path: segmentsToPath(segs) });
  }
  return { rows: out };
}

export function CategoryPickerManual(props: {
  apiBaseUrl?: string;
  storageKey?: string;
  value: CategoryValue;
  onChange: (v: CategoryValue) => void;
  maxDepth?: number;
  showSearchTab?: boolean;
  showPickTab?: boolean;
  showDictionaryManager?: boolean;
  /**
   * 현재 등록 현황(최근 항목 리스트)을 노출할지 여부.
   * - 기본값 false: 자동완성/선택 UX 테스트와 화면 면적을 안정화
   * - 설정 화면에서는 true로 켜서 현황 확인에 사용
   */
  showDictionaryStatusList?: boolean;
  /**
   * CSV 첨부 후 즉시 반영할지, "저장" 버튼을 눌러야 반영할지 선택.
   * - auto: 파일 선택 즉시 entries에 merge(=자동 저장)
   * - manual: 파일 선택 후 pending으로 보관 → 저장 버튼 클릭 시 반영
   */
  importMode?: 'auto' | 'manual';
}): JSX.Element {
  const apiBaseUrl = String(props.apiBaseUrl || '').trim();
  const useServerStore = Boolean(apiBaseUrl);
  const storageKey = props.storageKey || 'seoCategoryDictionary.v1';
  const storageMetaKey = `${storageKey}.meta`;
  const maxDepth = Math.min(4, Math.max(2, props.maxDepth ?? 4));
  const showSearchTab = props.showSearchTab ?? true;
  const showPickTab = props.showPickTab ?? true;
  const showDictionaryManager = props.showDictionaryManager ?? true;
  const showDictionaryStatusList = props.showDictionaryStatusList ?? false;
  const importMode = props.importMode ?? 'auto';

  const [entries, setEntries] = useState<CategoryEntry[]>(() => {
    if (useServerStore) return [];
    const cur = safeJsonParse<CategoryEntry[]>(localStorage.getItem(storageKey), []);
    // 주의: localStorage 저장 시 segments를 제외하므로, 재로딩 시 path -> segments를 복원해야 트리 UI가 정상 동작한다.
    // (메뉴 이동 후 “사라짐”처럼 보이는 현상 방지)
    if (cur && cur.length > 0) return cur.map(withSegments);
    // 마이그레이션: 과거 "템플릿"으로 저장해 둔 카테고리를 수동 사전으로 흡수
    const legacyTemplates = safeJsonParse<any[]>(localStorage.getItem('seoCategoryTemplates.v1'), []);
    if (!Array.isArray(legacyTemplates) || legacyTemplates.length === 0) return cur;
    const mapped: CategoryEntry[] = legacyTemplates
      .map((t) => {
        const id = String(t?.id || '').trim();
        const path = String(t?.path || '').trim();
        if (!/^\d+$/.test(id) || !path) return null;
        const segs = normalizePathToSegments(path);
        if (segs.length < 2) return null;
        return {
          id,
          path: segmentsToPath(segs),
          segments: segs,
          savedAt: String(t?.savedAt || new Date().toISOString()),
        } satisfies CategoryEntry;
      })
      .filter(Boolean) as CategoryEntry[];
    return mapped.map(withSegments);
  });

  const [activeTab, setActiveTab] = useState<'search' | 'pick'>(() => {
    if (showSearchTab) return 'search';
    return 'pick';
  });
  const [query, setQuery] = useState('');
  const [dictQuery, setDictQuery] = useState('');

  const [addId, setAddId] = useState('');
  const [addPath, setAddPath] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [pendingImportRows, setPendingImportRows] = useState<Array<{ id: string; path: string }>>([]);
  const [pendingImportMeta, setPendingImportMeta] = useState<{ encoding: string; parsed: number; filename: string } | null>(null);
  const [storageHint, setStorageHint] = useState<string | null>(null);
  const [dictMeta, setDictMeta] = useState<CategoryDictMeta | null>(() => {
    if (useServerStore) return null;
    return safeJsonParse<CategoryDictMeta | null>(localStorage.getItem(storageMetaKey), null);
  });
  const [uploadFiles, setUploadFiles] = useState<CategoryDictionaryFileItem[]>([]);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);

  // 현재 선택(세그먼트)
  const [selSegs, setSelSegs] = useState<string[]>(() => normalizePathToSegments(props.value?.path || ''));

  const refreshDictionaryFromServer = useCallback(async (): Promise<void> => {
    if (!useServerStore) return;
    const res = await axios.get<CategoryDictionaryApiResponse>(`${apiBaseUrl}/seo/category-dictionary`);
    const body = (res.data || {}) as CategoryDictionaryApiResponse;
    const items = Array.isArray(body.items) ? body.items : [];
    setEntries(
      items.map((item) =>
        withSegments({
          id: String(item.id || '').trim(),
          path: String(item.path || '').trim(),
          savedAt: String(item.saved_at || item.updated_at || new Date().toISOString()),
          sourceFilename: String(item.source_filename || '').trim() || null,
          updatedAt: String(item.updated_at || '').trim() || null,
        }),
      ),
    );
    const latest = body.latest_upload ?? null;
    if (latest?.filename && latest?.saved_at) {
      setDictMeta({
        filename: String(latest.filename || '').trim(),
        parsedRows: Number(latest.parsed_rows || 0),
        savedAt: String(latest.saved_at || '').trim(),
      });
    } else {
      setDictMeta(null);
    }
    const fileRows = Array.isArray(body.files) ? body.files : [];
    setUploadFiles(
      fileRows.map((row) => ({
        batchId: String(row.batch_id || '').trim(),
        filename: String(row.filename || '').trim(),
        parsedRows: Number(row.parsed_rows || 0),
        uploadedAt: String(row.uploaded_at || '').trim() || null,
        appliedAt: String(row.applied_at || '').trim() || null,
        isActive: Boolean(row.is_active),
      })),
    );
    setActiveBatchId(String(body.active_batch_id || '').trim() || null);
    setStorageHint(null);
  }, [apiBaseUrl, useServerStore]);

  useEffect(() => {
    if (useServerStore) return;
    const payload = JSON.stringify(serializeEntries(entries));
    const ls = safeLocalStorageSet(storageKey, payload);
    if (!ls.ok) {
      // localStorage 용량 초과 등: IndexedDB로 폴백(대용량 안정 저장)
      void idbSet(storageKey, serializeEntries(entries));
      setStorageHint('로컬 저장소 용량 제한으로 IndexedDB에 저장했습니다. (메뉴 이동 후에도 유지됩니다)');
    } else {
      // 소용량이어도 안정성을 위해 IndexedDB에도 같이 저장
      void idbSet(storageKey, serializeEntries(entries));
      setStorageHint(null);
    }
    // 설정 화면에서 사전을 갱신하면 다른 화면에서도 쉽게 반영할 수 있도록 이벤트를 브로드캐스트한다.
    try {
      window.dispatchEvent(new CustomEvent('seo:category-dict-updated'));
    } catch {
      // ignore
    }
  }, [entries, storageKey, useServerStore]);

  useEffect(() => {
    if (useServerStore) return;
    // mount 시 IndexedDB에 저장된 대용량 사전을 복원한다(메뉴 이동 시 유지).
    let cancelled = false;
    (async () => {
      const v = await idbGet<Array<{ id: string; path: string; savedAt: string }>>(storageKey);
      if (cancelled) return;
      if (!v || !Array.isArray(v) || v.length === 0) return;
      setEntries((prev) => {
        const map = new Map<string, CategoryEntry>();
        for (const p of prev || []) map.set(`${p.id}|${p.path}`, withSegments(p));
        for (const r of v) {
          const id = String((r as any)?.id || '').trim();
          const path = String((r as any)?.path || '').trim();
          const savedAt = String((r as any)?.savedAt || '').trim() || new Date().toISOString();
          if (!/^\d+$/.test(id) || !path) continue;
          const key = `${id}|${path}`;
          if (map.has(key)) continue;
          map.set(key, withSegments({ id, path, savedAt }));
        }
        return Array.from(map.values()).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey, useServerStore]);

  useEffect(() => {
    if (useServerStore) return;
    // mount 시 meta(파일명/건수/저장시각)도 복원한다.
    // localStorage 용량 초과로 meta 저장이 실패한 경우에도 메뉴 이동 후 유지되도록 IndexedDB를 폴백으로 사용.
    let cancelled = false;
    (async () => {
      const cur = safeJsonParse<CategoryDictMeta | null>(localStorage.getItem(storageMetaKey), null);
      if (cancelled) return;
      if (cur && cur.filename && cur.savedAt) {
        setDictMeta(cur);
        // 안정성을 위해 IndexedDB에도 동기화(소용량)
        void idbSet(storageMetaKey, cur);
        return;
      }
      const v = await idbGet<CategoryDictMeta>(storageMetaKey);
      if (cancelled) return;
      if (!v) return;
      if (typeof (v as any)?.filename !== 'string' || typeof (v as any)?.savedAt !== 'string') return;
      setDictMeta(v);
    })();
    return () => {
      cancelled = true;
    };
  }, [storageMetaKey, useServerStore]);

  useEffect(() => {
    if (!useServerStore) return;
    let cancelled = false;
    (async () => {
      try {
        await refreshDictionaryFromServer();
      } catch (e: any) {
        if (cancelled) return;
        setImportError(String(e?.response?.data?.detail ?? e?.message ?? '카테고리 사전을 불러오지 못했습니다.'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshDictionaryFromServer, useServerStore]);

  useEffect(() => {
    // 외부 value 변경 시 내부 선택 동기화
    setSelSegs(normalizePathToSegments(props.value?.path || ''));
  }, [props.value?.path]);

  const filteredEntries = useMemo(() => {
    // 트리 선택 탭에서는 query로 필터링하지 않는다(리스트가 안 뜨는 문제 방지)
    if (activeTab !== 'search') return entries;
    const q = (query || '').trim();
    if (!q) return entries;
    const nq = normalizeForSearch(q);
    if (!nq) return entries;
    return entries.filter((e) => normalizeForSearch(e.path).includes(nq));
  }, [entries, query, activeTab]);

  const topMatches = useMemo(() => {
    const q = (query || '').trim();
    // 입력이 비어있으면 후보 리스트를 노출하지 않는다(불필요한 면적 점유 방지)
    if (!q) return [];
    const nq = normalizeForSearch(q);
    if (!nq) return [];
    const matches = entries.filter((e) => normalizeForSearch(e.path).includes(nq));
    // 최신 저장 우선(사용자가 자주 쓰는 카테고리)
    matches.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    return matches.slice(0, 12);
  }, [entries, query]);

  const dictMatchedEntries = useMemo(() => {
    const q = (dictQuery || '').trim();
    if (!q) return null;
    const nq = normalizeForSearch(q);
    if (!nq) return null;
    const matches = entries.filter((e) => normalizeForSearch(e.path).includes(nq));
    matches.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    return matches;
  }, [entries, dictQuery]);

  const depth = useMemo(() => {
    let d = 0;
    for (const e of filteredEntries) d = Math.max(d, (e.segments || []).length);
    return Math.min(maxDepth, Math.max(2, d || maxDepth));
  }, [filteredEntries, maxDepth]);

  const optionsByLevel = useMemo(() => {
    const out: string[][] = [];
    for (let level = 0; level < depth; level += 1) {
      const prefix = selSegs.slice(0, level);
      const set = new Set<string>();
      for (const it of filteredEntries) {
        const segs = it.segments || [];
        let ok = true;
        for (let i = 0; i < prefix.length; i += 1) {
          if (segs[i] !== prefix[i]) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        const v = segs[level];
        if (typeof v === 'string' && v.trim()) set.add(v);
      }
      out.push(Array.from(set).sort((a, b) => a.localeCompare(b)));
    }
    return out;
  }, [filteredEntries, selSegs, depth]);

  const leafCandidates = useMemo(() => {
    const prefix = selSegs.filter(Boolean);
    if (prefix.length === 0) return [];
    const matches = filteredEntries.filter((it) => {
      const segs = it.segments || [];
      if (segs.length < prefix.length) return false;
      for (let i = 0; i < prefix.length; i += 1) {
        if (segs[i] !== prefix[i]) return false;
      }
      return true;
    });
    // 동일 prefix에서 가장 깊은(상세) 후보 우선
    let bestDepth = 0;
    for (const m of matches) bestDepth = Math.max(bestDepth, (m.segments || []).length);
    return matches
      .filter((m) => (m.segments || []).length === bestDepth)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }, [filteredEntries, selSegs]);

  function pick(level: number, seg: string): void {
    setSelSegs((prev) => {
      const next = prev.slice(0, level);
      next[level] = seg;
      return next;
    });
    // 아직 leaf가 확정이 아니면 value는 유지하지 않음(혼동 방지)
    props.onChange(null);
  }

  function applyLeaf(e: CategoryEntry): void {
    props.onChange({ id: e.id, path: e.path });
    setSelSegs((e.segments && e.segments.length > 0 ? e.segments : normalizePathToSegments(e.path)) || []);
  }

  async function addEntry(): Promise<void> {
    const id = (addId || '').trim();
    const path = (addPath || '').trim();
    if (!/^\d+$/.test(id)) return;
    const segs = normalizePathToSegments(path);
    if (segs.length < 2) return;
    const normalizedPath = segmentsToPath(segs);
    const item: CategoryEntry = {
      id,
      path: normalizedPath,
      segments: segs,
      savedAt: new Date().toISOString(),
        sourceFilename: null,
        updatedAt: null,
    };
    if (useServerStore) {
      try {
        const res = await axios.post<CategoryDictionaryImportResponse>(`${apiBaseUrl}/seo/category-dictionary/import`, {
          filename: 'manual-entry',
          items: [{ id, path: normalizedPath }],
        });
        await refreshDictionaryFromServer();
        const body = res.data;
        setImportStatus(`수기 등록 완료: 신규 ${Number(body?.inserted || 0)}건, 중복 ${Number(body?.skipped || 0)}건`);
        setImportError(null);
      } catch (e: any) {
        setImportError(String(e?.response?.data?.detail ?? e?.message ?? '카테고리 추가 실패'));
        return;
      }
      setAddId('');
      setAddPath('');
      return;
    }
    setEntries((prev) => {
      const next = prev.filter((p) => !(p.id === item.id && p.path === item.path));
      next.unshift(withSegments(item));
      return next.slice(0, 500);
    });
    setAddId('');
    setAddPath('');
  }

  function removeEntry(idx: number): void {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
  }

  async function removeEntryByKey(id: string, path: string): Promise<void> {
    if (useServerStore) {
      setImportError('개별 카테고리 삭제는 지원하지 않습니다. 업로드 파일 표에서 삭제해 주세요.');
      return;
    }
    setEntries((prev) => prev.filter((e) => !(e.id === id && e.path === path)));
  }

  async function applyUploadFile(batchId: string): Promise<void> {
    if (!useServerStore) return;
    try {
      const res = await axios.post(`${apiBaseUrl}/seo/category-dictionary/apply`, { batch_id: batchId });
      await refreshDictionaryFromServer();
      setImportStatus(`업로드 파일 적용 완료: ${String((res.data as any)?.filename || '').trim() || '선택 파일'}`);
      setImportError(null);
    } catch (e: any) {
      setImportError(String(e?.response?.data?.detail ?? e?.message ?? '업로드 파일 적용 실패'));
    }
  }

  async function deleteUploadFile(batchId: string): Promise<void> {
    if (!useServerStore) return;
    try {
      await axios.post(`${apiBaseUrl}/seo/category-dictionary/delete`, { batch_id: batchId });
      await refreshDictionaryFromServer();
      setImportStatus('업로드 파일 삭제 완료');
      setImportError(null);
    } catch (e: any) {
      setImportError(String(e?.response?.data?.detail ?? e?.message ?? '업로드 파일 삭제 실패'));
    }
  }

  const selectedPathText = useMemo(() => {
    const p = segmentsToPath(selSegs.filter(Boolean));
    return p || '-';
  }, [selSegs]);

  async function importCsv(file: File): Promise<void> {
    setImportError(null);
    setImportStatus(null);
    try {
      const buf = await file.arrayBuffer();
      const { text, encoding } = decodeBestEffort(buf);
      const parsed = parseCategoryCsv(text);
      if (parsed.error) {
        setImportError(parsed.error);
        return;
      }
      const rows = parsed.rows;
      if (rows.length === 0) {
        setImportError('CSV에서 유효한 카테고리를 찾지 못했습니다. (형식/인코딩 확인 필요)');
        return;
      }
      if (importMode === 'manual') {
        setPendingImportRows(rows);
        setPendingImportMeta({ encoding, parsed: rows.length, filename: String(file?.name || '').trim() || 'unknown.csv' });
        setImportStatus(`CSV(${encoding}) 파싱 완료: ${rows.length}건 (저장 버튼을 누르면 반영됩니다)`);
        return;
      }

      if (useServerStore) {
        const res = await axios.post<CategoryDictionaryImportResponse>(`${apiBaseUrl}/seo/category-dictionary/import`, {
          filename: String(file?.name || '').trim() || 'unknown.csv',
          items: rows,
        });
        await refreshDictionaryFromServer();
        setImportStatus(
          `CSV(${encoding}) 저장 완료: ${Number(res.data?.parsed || rows.length)}건 반영, 신규 ${Number(res.data?.inserted || 0)}건 등록`,
        );
        return;
      }

      const now = new Date().toISOString();
      setEntries((prev) => {
        const map = new Map<string, CategoryEntry>();
        for (const p of prev) map.set(`${p.id}|${p.path}`, withSegments(p));
        let added = 0;
        for (const r of rows) {
          const key = `${r.id}|${r.path}`;
          if (map.has(key)) continue;
          const e: CategoryEntry = withSegments({ id: r.id, path: r.path, savedAt: now });
          map.set(key, e);
          added += 1;
        }
        const merged = Array.from(map.values()).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
        setImportStatus(`CSV(${encoding})에서 ${rows.length}건 파싱, 신규 ${added}건 등록 완료`);
        return merged.slice(0, 5000);
      });
    } catch (e: any) {
      setImportError(e?.message || 'CSV 가져오기 실패');
    }
  }

  async function applyPendingImport(): Promise<void> {
    if (pendingImportRows.length === 0) return;
    const now = new Date().toISOString();
    const rows = pendingImportRows;
    const encoding = pendingImportMeta?.encoding || 'utf-8';
    const filename = pendingImportMeta?.filename || 'unknown.csv';
    if (useServerStore) {
      try {
        const res = await axios.post<CategoryDictionaryImportResponse>(`${apiBaseUrl}/seo/category-dictionary/import`, {
          filename,
          items: rows,
        });
        await refreshDictionaryFromServer();
        setImportStatus(
          `CSV(${encoding}) 저장 완료: ${Number(res.data?.parsed || rows.length)}건 반영, 신규 ${Number(res.data?.inserted || 0)}건 등록`,
        );
        setImportError(null);
        setPendingImportRows([]);
        setPendingImportMeta(null);
      } catch (e: any) {
        setImportError(String(e?.response?.data?.detail ?? e?.message ?? '카테고리 저장 실패'));
      }
      return;
    }
    setEntries((prev) => {
      const map = new Map<string, CategoryEntry>();
      for (const p of prev) map.set(`${p.id}|${p.path}`, withSegments(p));
      let added = 0;
      for (const r of rows) {
        const key = `${r.id}|${r.path}`;
        if (map.has(key)) continue;
        const e: CategoryEntry = withSegments({ id: r.id, path: r.path, savedAt: now });
        map.set(key, e);
        added += 1;
      }
      const merged = Array.from(map.values()).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
      setImportStatus(`CSV(${encoding}) 저장 완료: ${rows.length}건 반영, 신규 ${added}건 등록`);
      // 메타(파일명/시각/건수)는 소용량이므로 localStorage에 별도 저장해 "무엇을 저장했는지"를 화면에 표시한다.
      const meta: CategoryDictMeta = { filename, savedAt: now, parsedRows: rows.length };
      setDictMeta(meta);
      const metaPayload = JSON.stringify(meta);
      const ls = safeLocalStorageSet(storageMetaKey, metaPayload);
      // meta는 작지만, entries 저장과 동일하게 IndexedDB에도 항상 저장해 둔다(메뉴 이동 후 유지).
      void idbSet(storageMetaKey, meta);
      if (!ls.ok) {
        // entries는 이미 IndexedDB로 폴백하지만, 사용자 입장에서는 meta가 사라지는 게 더 혼란이 크다.
        // 그래서 meta 저장 실패를 명확히 힌트로 남긴다.
        setStorageHint('로컬 저장소 용량 제한으로 IndexedDB에 저장했습니다. (메뉴 이동 후에도 유지됩니다)');
      }
      return merged.slice(0, 5000);
    });
    setPendingImportRows([]);
    setPendingImportMeta(null);
  }

  function cancelPendingImport(): void {
    setPendingImportRows([]);
    setPendingImportMeta(null);
    setImportStatus(null);
    setImportError(null);
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {(showSearchTab && showPickTab) || (showSearchTab && activeTab !== 'search') || (showPickTab && activeTab !== 'pick') ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {showSearchTab ? (
            <button
              type="button"
              className={`submenu-tab${activeTab === 'search' ? ' submenu-tab-active' : ''}`}
              onClick={() => setActiveTab('search')}
            >
              카테고리명 검색
            </button>
          ) : null}
          {showPickTab ? (
            <button
              type="button"
              className={`submenu-tab${activeTab === 'pick' ? ' submenu-tab-active' : ''}`}
              onClick={() => setActiveTab('pick')}
            >
              카테고리명 선택
            </button>
          ) : null}
        </div>
      ) : null}

      {showSearchTab && activeTab === 'search' ? (
        <div style={{ border: '1px solid rgba(148, 163, 184, 0.14)', borderRadius: 10, padding: 10, background: 'rgba(2, 6, 23, 0.35)' }}>
          <label className="field-label" htmlFor="cat-manual-query">
            카테고리 입력(자동완성)
          </label>
          <input
            id="cat-manual-query"
            className="input"
            placeholder="예: 화장품/미용 헤어스타일링 염색약"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const first = topMatches[0];
                if (first) applyLeaf(first);
              }
            }}
          />
          <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8', fontWeight: 800 }}>
            입력하면 저장된 카테고리 텍스트에서 자동완성으로 매칭됩니다. (Enter: 첫 후보 선택)
          </div>
          {(() => {
            const q = (query || '').trim();
            if (!q) {
              return <div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>카테고리명을 입력하면 자동완성 후보가 표시됩니다.</div>;
            }
            if (topMatches.length > 0) {
              return (
                <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                  {topMatches.map((m) => (
                    <button
                      type="button"
                      key={`${m.id}|${m.path}`}
                      className="seo-cat-item"
                      onClick={() => applyLeaf(m)}
                      style={{ justifyContent: 'flex-start' }}
                      title={`id ${m.id}`}
                    >
                      <span style={{ fontWeight: 900, color: '#bbf7d0', marginRight: 8 }}>{m.id}</span>
                      <span style={{ fontWeight: 900 }}>{m.path}</span>
                    </button>
                  ))}
                </div>
              );
            }
            return <div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>매칭 결과가 없습니다. 아래 “카테고리 추가”로 먼저 등록하세요.</div>;
          })()}
        </div>
      ) : null}

      {showPickTab && activeTab === 'pick' ? (
        <div className="seo-cat-tree">
        {optionsByLevel.map((opts, level) => (
          <div key={level} className="seo-cat-col">
            <div className="seo-cat-col-title">
              {level === 0 ? '메인' : level === 1 ? '서브' : level === 2 ? '상세' : '세부'}
            </div>
            <div className="seo-cat-col-body">
              {opts.length === 0 ? (
                <div style={{ fontSize: 12, color: '#94a3b8' }}>항목 없음</div>
              ) : (
                opts.map((seg) => {
                  const active = selSegs[level] === seg;
                  return (
                    <button
                      type="button"
                      key={seg}
                      className={`seo-cat-item${active ? ' active' : ''}`}
                      onClick={() => pick(level, seg)}
                      aria-label={`${seg} ›`}
                    >
                      {seg}
                      {/* 접근성: 버튼 이름이 "화장품 ›"처럼 읽히도록 화살표 앞에 공백을 포함 */}
                      <span className="seo-cat-arrow"> {'›'}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ))}

        <div className="seo-cat-leaf">
          <div className="seo-cat-col-title">선택 후보</div>
          <div className="seo-cat-col-body">
            <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 800, marginBottom: 8 }}>
              선택 경로: {selectedPathText}
            </div>
            {leafCandidates.length === 0 ? (
              <div style={{ fontSize: 12, color: '#94a3b8' }}>좌측에서 카테고리를 선택하세요.</div>
            ) : (
              leafCandidates.slice(0, 12).map((c) => (
                <div key={`${c.id}|${c.path}`} className="seo-cat-leaf-row">
                  <div className="seo-cat-leaf-path">{c.path}</div>
                  <div className="seo-cat-leaf-meta">
                    <span className="pill">id {c.id}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <button type="button" className="btn-primary" onClick={() => applyLeaf(c)}>
                      선택
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => {
                        void removeEntryByKey(c.id, c.path);
                      }}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      ) : null}

      {showDictionaryManager ? (
      <div style={{ border: '1px solid rgba(148, 163, 184, 0.14)', borderRadius: 10, padding: 10, background: 'rgba(2, 6, 23, 0.35)' }}>
        <div style={{ display: 'grid', gap: 14 }}>
          {/* 1) 사전 업로드 */}
          <div>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>사전 업로드</div>
            <label className="field-label" htmlFor="cat-csv-import">
              카테고리 CSV
            </label>
            <input
              id="cat-csv-import"
              className="input"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importCsv(f);
              }}
            />
            <div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8', fontWeight: 800 }}>
              CP949(EUC-KR) CSV도 자동 판별합니다. (예: category_*.csv)
            </div>
            {importMode === 'manual' ? (
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" className="btn-primary" onClick={() => void applyPendingImport()} disabled={pendingImportRows.length === 0}>
                  저장
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={cancelPendingImport}
                  disabled={pendingImportRows.length === 0 && !importStatus && !importError}
                >
                  취소
                </button>
                {pendingImportRows.length > 0 ? (
                  <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 800 }}>
                    미리보기: {pendingImportRows.length.toLocaleString()}건
                  </span>
                ) : null}
              </div>
            ) : null}
            {importStatus ? <div style={{ marginTop: 8, fontSize: 12, color: '#bbf7d0', fontWeight: 900 }}>{importStatus}</div> : null}
            {importError ? <div style={{ marginTop: 8, fontSize: 12, color: '#fca5a5', fontWeight: 900 }}>{importError}</div> : null}
          </div>

          {/* 2) 카테고리 검색 */}
          {showDictionaryStatusList ? (
            <div>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>카테고리 검색</div>
              <div>
                <label className="field-label" htmlFor="cat-dict-query">
                  카테고리 검색(키워드 포함)
                </label>
                <input
                  id="cat-dict-query"
                  className="input"
                  placeholder="예: 염색약, DIY, 화장품"
                  value={dictQuery}
                  onChange={(e) => setDictQuery(e.target.value)}
                />
                {dictQuery.trim() ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8', fontWeight: 800 }}>
                    검색 결과: {(dictMatchedEntries?.length ?? 0).toLocaleString()}건 (최대 200건 표시)
                  </div>
                ) : (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8', fontWeight: 800 }}>
                    검색어를 입력하면 현재 적용 중인 카테고리 항목을 검색합니다.
                  </div>
                )}
              </div>
              <div style={{ marginTop: 10, maxHeight: 220, overflow: 'auto', border: '1px solid rgba(148,163,184,0.14)', borderRadius: 10 }}>
                {dictMatchedEntries ? (
                  dictMatchedEntries.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                      <thead>
                        <tr style={{ background: 'rgba(15, 23, 42, 0.92)' }}>
                          <th style={{ width: 110, padding: '10px 12px', textAlign: 'left', fontSize: 12, color: '#cbd5e1' }}>ID</th>
                          <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: '#cbd5e1' }}>카테고리 경로</th>
                          <th style={{ width: 180, padding: '10px 12px', textAlign: 'left', fontSize: 12, color: '#cbd5e1' }}>업로드 파일명</th>
                          <th style={{ width: 170, padding: '10px 12px', textAlign: 'left', fontSize: 12, color: '#cbd5e1' }}>업로드 일자</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dictMatchedEntries.slice(0, 200).map((e, idx) => (
                          <tr key={`${e.id}|${e.path}|${e.savedAt}`} style={{ borderTop: idx === 0 ? '1px solid rgba(148,163,184,0.10)' : '1px solid rgba(148,163,184,0.10)' }}>
                            <td style={{ padding: '10px 12px', color: '#bbf7d0', fontWeight: 900, verticalAlign: 'top' }}>{e.id}</td>
                            <td style={{ padding: '10px 12px', color: '#e2e8f0', fontWeight: 800, wordBreak: 'break-word' }}>{e.path}</td>
                            <td style={{ padding: '10px 12px', color: '#cbd5e1', fontSize: 12, verticalAlign: 'top' }}>{e.sourceFilename || '-'}</td>
                            <td style={{ padding: '10px 12px', color: '#cbd5e1', fontSize: 12, verticalAlign: 'top' }}>{formatDateTimeLabel(e.savedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ padding: 10, fontSize: 12, color: '#94a3b8' }}>검색 결과가 없습니다.</div>
                  )
                ) : (
                  <div style={{ padding: 10, fontSize: 12, color: '#94a3b8' }}>검색어를 입력하면 결과가 표시됩니다.</div>
                )}
              </div>
            </div>
          ) : null}

          {/* 3) 수기 등록 */}
          <div>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>수기 등록</div>
            <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 120px', gap: 10, alignItems: 'end' }}>
              <div>
                <label className="field-label" htmlFor="cat-manual-id">
                  카테고리 ID(숫자)
                </label>
                <input
                  id="cat-manual-id"
                  className="input"
                  placeholder="예: 50000002"
                  value={addId}
                  onChange={(e) => setAddId(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="cat-manual-path">
                  카테고리 경로(예: 화장품/미용&gt;헤어스타일링&gt;염색약)
                </label>
                <input
                  id="cat-manual-path"
                  className="input"
                  placeholder="예: 화장품/미용>헤어스타일링>염색약"
                  value={addPath}
                  onChange={(e) => setAddPath(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'end' }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void addEntry()}
                  disabled={!/^\d+$/.test(addId.trim()) || normalizePathToSegments(addPath).length < 2}
                >
                  추가
                </button>
              </div>
            </div>
          </div>

          {/* 4) 현재 등록 현황 */}
          <div>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>현재 등록 현황</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 900 }}>
                {useServerStore ? `업로드 파일 ${uploadFiles.length.toLocaleString()}건` : `총 ${entries.length.toLocaleString()}건`}
              </span>
              {dictMeta ? (
                <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 800 }}>
                  마지막 저장: {dictMeta.filename} · {dictMeta.parsedRows.toLocaleString()}건 · {dictMeta.savedAt.slice(0, 19).replace('T', ' ')}
                </span>
              ) : null}
            </div>
            {storageHint ? (
              <div style={{ marginTop: 8, fontSize: 12, color: '#fde68a', fontWeight: 900 }}>
                {storageHint}
              </div>
            ) : null}
            {showDictionaryStatusList ? (
              <>
                <div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8', fontWeight: 800 }}>서버 DB 기준 업로드 파일 최근 30건만 표시됩니다.</div>
                <div style={{ marginTop: 10, maxHeight: 320, overflow: 'auto', border: '1px solid rgba(148,163,184,0.14)', borderRadius: 10 }}>
                  {(() => {
                    const list = (uploadFiles || []).slice(0, 30);
                    return list.length > 0 ? (
                      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                        <thead>
                          <tr style={{ background: 'rgba(15, 23, 42, 0.92)' }}>
                            <th style={{ width: 220, padding: '10px 12px', textAlign: 'left', fontSize: 12, color: '#cbd5e1' }}>상태</th>
                            <th style={{ width: 180, padding: '10px 12px', textAlign: 'left', fontSize: 12, color: '#cbd5e1' }}>업로드 파일명</th>
                            <th style={{ width: 100, padding: '10px 12px', textAlign: 'left', fontSize: 12, color: '#cbd5e1' }}>건수</th>
                            <th style={{ width: 170, padding: '10px 12px', textAlign: 'left', fontSize: 12, color: '#cbd5e1' }}>업로드 일자</th>
                            <th style={{ width: 140, padding: '10px 12px', textAlign: 'left', fontSize: 12, color: '#cbd5e1' }}>작업</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((e, idx) => (
                            <tr key={e.batchId} style={{ borderTop: idx === 0 ? '1px solid rgba(148,163,184,0.10)' : '1px solid rgba(148,163,184,0.10)' }}>
                              <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>
                                <div style={{ display: 'grid', gap: 4 }}>
                                  <span style={{ color: e.isActive ? '#86efac' : '#94a3b8', fontWeight: 900 }}>
                                    {e.isActive ? '현재 적용 중' : '대기'}
                                  </span>
                                  <span style={{ color: '#94a3b8', fontSize: 12 }}>
                                    적용 일자: {formatDateTimeLabel(e.appliedAt)}
                                  </span>
                                </div>
                              </td>
                              <td style={{ padding: '10px 12px', color: '#cbd5e1', fontSize: 12, verticalAlign: 'top', wordBreak: 'break-word' }}>{e.filename || '-'}</td>
                              <td style={{ padding: '10px 12px', color: '#e2e8f0', fontWeight: 800, verticalAlign: 'top' }}>{e.parsedRows.toLocaleString()}</td>
                              <td style={{ padding: '10px 12px', color: '#cbd5e1', fontSize: 12, verticalAlign: 'top' }}>{formatDateTimeLabel(e.uploadedAt)}</td>
                              <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                  <button
                                    type="button"
                                    className="btn-primary"
                                    onClick={() => void applyUploadFile(e.batchId)}
                                    disabled={e.isActive || activeBatchId === e.batchId}
                                    style={{ fontSize: 11, padding: '4px 8px' }}
                                  >
                                    적용
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-ghost"
                                    onClick={() => void deleteUploadFile(e.batchId)}
                                    style={{ fontSize: 11, padding: '4px 8px' }}
                                  >
                                    삭제
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : null;
                  })()}
                  {uploadFiles.length === 0 ? (
                    <div style={{ padding: 10, fontSize: 12, color: '#94a3b8' }}>등록된 업로드 파일이 없습니다.</div>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
      ) : null}
    </div>
  );
}


