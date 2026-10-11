import os
import re
import math
import sys
import uuid
import json
from datetime import datetime, date
from typing import Iterable, Any

from sqlalchemy import (
    Column,
    Date,
    DateTime,
    Float,
    Numeric,
    Integer,
    String,
    Text,
    Boolean,
    BigInteger,
    Index,
    create_engine,
    case,
    text,
)
from sqlalchemy import insert as sa_insert
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session, declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool

from ads_conversion_semantics import normalize_conversion_metrics


def _normalize_db_url(raw: str) -> str:
    """
    SQLAlchemy 2.x에서 PostgreSQL 드라이버를 명시적으로 선택한다.

    배경:
    - Windows + Python 3.13 환경에서는 psycopg2-binary가 wheel을 제공하지 않아 설치가 실패할 수 있다.
    - psycopg3(psycopg)는 3.13을 지원하며, SQLAlchemy에서 `postgresql+psycopg://`로 사용한다.
    - 기존 환경변수(postgresql://...)를 그대로 두더라도 동작하도록, driver가 없으면 자동으로 +psycopg를 붙인다.
    """
    s = (raw or "").strip()
    if not s:
        return s
    # 이미 driver가 명시된 경우는 그대로 둔다.
    if s.startswith("postgresql+"):
        return s
    if s.startswith("postgres://"):
        # 일부 환경에서 postgres://를 쓰는 경우가 있어 표준 스킴으로 치환
        s = "postgresql://" + s[len("postgres://") :]
    if s.startswith("postgresql://"):
        return "postgresql+psycopg://" + s[len("postgresql://") :]
    return s


def _is_testing() -> bool:
    """
    테스트가 운영 DB를 오염시키는 것을 방지한다.
    - pytest 실행 시 PYTEST_CURRENT_TEST 가 설정됨
    - 추가로 ANALYTICS_TESTING=1 도 허용
    """
    v = str(os.getenv("ANALYTICS_TESTING") or "").strip().lower()
    if v in ("1", "true", "yes", "y", "on"):
        return True
    return bool(os.getenv("PYTEST_CURRENT_TEST"))


# pytest는 테스트 수집 단계에서 환경변수가 아직 없을 수 있어,
# sys.argv 기반으로도 한 번 더 감지한다(운영/개발 환경에서는 해당 문자열이 들어갈 일이 거의 없음).
def _is_pytest_argv() -> bool:
    try:
        argv = [str(a or "").lower() for a in (sys.argv or [])]
    except Exception:
        argv = []
    return any("pytest" in a for a in argv)

def _is_unittest_argv() -> bool:
    """
    `python -m unittest` 로 실행되는 테스트도 운영 DB를 사용하지 않도록 감지한다.
    - Cursor/CI 환경에서 unittest가 자주 사용됨
    """
    try:
        argv = [str(a or "").lower() for a in (sys.argv or [])]
    except Exception:
        argv = []
    return any("unittest" in a for a in argv)


if _is_testing() or _is_pytest_argv() or _is_unittest_argv():
    # 테스트는 반드시 격리된 DB를 사용한다.
    # - In-memory는 커넥션이 바뀌면 테이블이 사라질 수 있어 StaticPool로 단일 커넥션을 유지한다.
    DATABASE_URL = "sqlite+pysqlite:///:memory:"
    engine = create_engine(
        DATABASE_URL,
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
else:
    DATABASE_URL = _normalize_db_url(
        os.getenv(
            "ANALYTICS_DB_URL",
            # 로컬 개발 기본값: 호스트 5442 → 컨테이너 5432 매핑
            "postgresql://analytics:analytics_pw@localhost:5442/analytics",
        )
    )
    engine = create_engine(DATABASE_URL, future=True)

# dialect별 insert 선택(Postgres/SQLite 모두 on_conflict를 안전하게 사용)
if str(getattr(engine, "dialect", None).name or "").lower() == "sqlite":
    insert = sqlite_insert
elif str(getattr(engine, "dialect", None).name or "").lower() == "postgresql":
    insert = pg_insert
else:
    insert = sa_insert
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()

def _normalize_campaign_kind_value(raw: object) -> str | None:
    """
    다양한 입력(광고센터 CSV/사용자 문자열)에서 캠페인유형을 표준값으로 정규화한다.

    표준값:
    - powerlink: 파워링크
    - shopping: 쇼핑검색/브랜드검색 등(파워링크가 아닌 검색광고 계열)
    - non_powerlink: (예약) shopping 외 기타를 따로 분리하고 싶을 때
    """
    s = str(raw or "").strip()
    if not s:
        return None
    s2 = s.lower().replace(" ", "")

    # 한국어/영문 혼용 대응
    if ("파워링크" in s) or ("powerlink" in s2):
        return "powerlink"
    # 쇼핑검색/브랜드검색은 파워링크가 아닌 검색광고 영역으로 묶어 처리한다.
    if ("쇼핑" in s) or ("브랜드" in s) or ("shopping" in s2) or ("brand" in s2) or ("sb" == s2) or ("ss" == s2):
        return "shopping"
    if s2 in ("non_powerlink", "nonpowerlink"):
        return "non_powerlink"
    return None

def _dedupe_creative_daily_records(records: list[dict]) -> list[dict]:
    """
    Postgres `INSERT .. ON CONFLICT DO UPDATE`는 한 statement 안에서 동일 PK가 중복되면
    `CardinalityViolation`로 실패한다.

    네이버 "소재 보고서" 업로드 CSV/XLSX는 상황에 따라 동일 (date, campaign, adgroup, creative_id, device)
    조합이 중복될 수 있어, DB upsert 전에 레코드를 PK 기준으로 합친다.

    병합 규칙(최소 안전):
    - 지표(impressions/clicks/cost/conversions/revenue): 합산
    - 비율 지표(ctr/cpc/cvr/roas): 합산된 지표로 재계산
    - avg_rank: 노출수 가중 평균(노출수 없으면 최소값)
    - 메타(creative_name/product_title/image_url): 비어있지 않은 값 우선
    - current_bid/quality_index: 큰 값 우선
    """
    if not records:
        return []

    def _nb(v: object) -> str:
        return str(v or "").strip()

    out: dict[tuple, dict] = {}
    rank_weight_sum: dict[tuple, float] = {}
    rank_weight_total: dict[tuple, int] = {}
    rank_min: dict[tuple, float] = {}

    for r in records:
        key = (
            r.get("date"),
            _nb(r.get("campaign_name")),
            _nb(r.get("adgroup_name")),
            _nb(r.get("creative_id")),
            _nb(r.get("display_keyword")),
            _nb(r.get("device")) or "ALL",
        )

        if key not in out:
            out[key] = dict(r)
        else:
            cur = out[key]
            for k in ("impressions", "clicks", "cost", "conversions", "revenue"):
                cur[k] = int(cur.get(k, 0) or 0) + int(r.get(k, 0) or 0)

            # 메타: 비어있지 않은 값 우선
            for k in ("product_title", "image_url"):
                if not _nb(cur.get(k)) and _nb(r.get(k)):
                    cur[k] = r.get(k)

            # creative_name은 id로만 들어온 케이스는 유지(기존 정책과 동일한 의도)
            cur_name = _nb(cur.get("creative_name"))
            new_name = _nb(r.get("creative_name"))
            cid = _nb(cur.get("creative_id"))
            if (not cur_name or cur_name == cid) and new_name and new_name != cid:
                cur["creative_name"] = new_name

            try:
                cur_bid = cur.get("current_bid")
                new_bid = r.get("current_bid")
                if new_bid is not None and (cur_bid is None or int(new_bid) > int(cur_bid)):
                    cur["current_bid"] = int(new_bid)
            except Exception:
                pass

            try:
                cur_q = cur.get("quality_index")
                new_q = r.get("quality_index")
                if new_q is not None and (cur_q is None or float(new_q) > float(cur_q)):
                    cur["quality_index"] = float(new_q)
            except Exception:
                pass

        # avg_rank 가중 평균 집계
        try:
            ar = r.get("avg_rank")
            if ar is not None:
                ar_f = float(ar)
                if math.isfinite(ar_f) and ar_f > 0:
                    impr = int(r.get("impressions", 0) or 0)
                    if impr > 0:
                        rank_weight_sum[key] = rank_weight_sum.get(key, 0.0) + ar_f * impr
                        rank_weight_total[key] = rank_weight_total.get(key, 0) + impr
                    else:
                        rank_min[key] = min(rank_min.get(key, ar_f), ar_f)
        except Exception:
            pass

    # 비율 재계산 + avg_rank 결정
    for key, cur in out.items():
        impr = int(cur.get("impressions", 0) or 0)
        clicks = int(cur.get("clicks", 0) or 0)
        cost = int(cur.get("cost", 0) or 0)
        conv = int(cur.get("conversions", 0) or 0)
        rev = int(cur.get("revenue", 0) or 0)

        cur["ctr"] = float((clicks / impr * 100.0) if impr > 0 else 0.0)
        cur["cpc"] = float((cost / clicks) if clicks > 0 else 0.0)
        cur["cvr"] = float((conv / clicks * 100.0) if clicks > 0 else 0.0)
        cur["roas"] = float((rev / cost * 100.0) if cost > 0 else 0.0)

        if rank_weight_total.get(key, 0) > 0:
            cur["avg_rank"] = float(rank_weight_sum.get(key, 0.0) / max(1, rank_weight_total[key]))
        elif key in rank_min:
            cur["avg_rank"] = float(rank_min[key])

    return list(out.values())


class NaverAdKeywordDaily(Base):
    __tablename__ = "naver_ad_keyword_daily"

    date = Column(Date, primary_key=True)
    campaign_name = Column(String, primary_key=True)
    adgroup_name = Column(String, primary_key=True)
    keyword = Column(String, primary_key=True)
    device = Column(String, primary_key=True, default="ALL")
    # 정확한 캠페인 유형 분리용(파워링크/쇼핑검색/기타)
    # - 과거에는 campaign_name prefix 기반으로 best-effort 필터링을 했지만, 보고서/업로드 데이터는 실제 유형 컬럼이 존재한다.
    # - 이 컬럼이 채워지면 조회 시 섞임 없이 정확히 필터링할 수 있다.
    campaign_kind = Column(String, nullable=True)

    impressions = Column(Integer, nullable=False, default=0)
    clicks = Column(Integer, nullable=False, default=0)
    cost = Column(Integer, nullable=False, default=0)
    conversions = Column(Integer, nullable=False, default=0)
    revenue = Column(Integer, nullable=False, default=0)
    conversion_semantics = Column(String, nullable=False, default="total_plus_purchase")
    # purchase 계열은 "실제 구매완료"만 분리 보존한다.
    purchase_conversions = Column(Integer, nullable=False, default=0)
    purchase_revenue = Column(Integer, nullable=False, default=0)

    ctr = Column(Float, nullable=False, default=0.0)
    cpc = Column(Float, nullable=False, default=0.0)
    cvr = Column(Float, nullable=False, default=0.0)
    roas = Column(Float, nullable=False, default=0.0)

    source = Column(String, nullable=False, default="unknown")
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        # SQLite 테스트에서도 테이블 생성이 가능하도록 SQL 표준 표현을 사용한다.
        server_default=text("CURRENT_TIMESTAMP"),
    )


class NaverAdSearchwordDaily(Base):
    __tablename__ = "naver_ad_searchword_daily"

    date = Column(Date, primary_key=True)
    campaign_name = Column(String, primary_key=True)
    adgroup_name = Column(String, primary_key=True)
    searchword = Column(String, primary_key=True)
    # UI "검색어 보고서"에는 (검색어, 키워드) 두 컬럼이 함께 존재한다.
    # - searchword: 실제 사용자 검색어(query)
    # - matched_keyword: 매칭된 키워드(보고서의 '키워드' 컬럼)
    # SearchAd API가 searchword report를 제공하지 않는 계정이 있어 UI CSV 업로드로 보정할 수 있으며,
    # 그때 키워드 매핑까지 보존하기 위해 별도 컬럼으로 저장한다.
    matched_keyword = Column(String, nullable=True)
    # 캠페인 유형(보고서에 존재하는 값) 보존: 파워링크/쇼핑검색 분리를 정확히 하기 위함
    campaign_kind = Column(String, nullable=True)
    device = Column(String, primary_key=True, default="ALL")

    impressions = Column(Integer, nullable=False, default=0)
    clicks = Column(Integer, nullable=False, default=0)
    cost = Column(Integer, nullable=False, default=0)
    conversions = Column(Integer, nullable=False, default=0)
    revenue = Column(Integer, nullable=False, default=0)
    conversion_semantics = Column(String, nullable=False, default="total_plus_purchase")
    purchase_conversions = Column(Integer, nullable=False, default=0)
    purchase_revenue = Column(Integer, nullable=False, default=0)

    ctr = Column(Float, nullable=False, default=0.0)
    cpc = Column(Float, nullable=False, default=0.0)
    cvr = Column(Float, nullable=False, default=0.0)
    roas = Column(Float, nullable=False, default=0.0)

    source = Column(String, primary_key=True, nullable=False, default="unknown")
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_ad_searchword_date_campaign_adgroup", "date", "campaign_name", "adgroup_name"),
        Index("ix_ad_searchword_date_matched_keyword", "date", "matched_keyword"),
        Index("ix_ad_searchword_searchword_date", "searchword", "date"),
        Index("ix_ad_searchword_source_date", "source", "date"),
        Index("ix_ad_searchword_kind_date", "campaign_kind", "date"),
    )


class NaverAdCreativeDaily(Base):
    """
    SearchAd 소재(AD) 단위 일간 스냅샷.

    - 메뉴3-3(소재 분석)에서 사용한다.
    - SearchAd stat-reports(AD) + AD_CONVERSION을 머지한 값을 저장한다.
    """

    __tablename__ = "naver_ad_creative_daily"

    date = Column(Date, primary_key=True)
    campaign_name = Column(String, primary_key=True)
    adgroup_name = Column(String, primary_key=True)
    creative_id = Column(String, primary_key=True)
    # 파워링크 소재는 광고센터처럼 같은 소재ID가 키워드별 행으로 표시된다.
    # 쇼핑/기타 소재는 빈 문자열(default)로 유지해 기존 소재 단위와 호환한다.
    display_keyword = Column(String, primary_key=True, nullable=False, default="")
    device = Column(String, primary_key=True, default="ALL")

    # 표시용 메타(수집 시점 스냅샷)
    creative_name = Column(String, nullable=False, default="")
    product_title = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    current_bid = Column(Integer, nullable=True)  # 현재 입찰가(원) - meta에서 best-effort
    quality_index = Column(Float, nullable=True)  # 품질지수 - meta/리포트에서 best-effort
    avg_rank = Column(Float, nullable=True)  # 평균 노출 순위 - 리포트에서 best-effort

    impressions = Column(Integer, nullable=False, default=0)
    clicks = Column(Integer, nullable=False, default=0)
    cost = Column(Integer, nullable=False, default=0)
    conversions = Column(Integer, nullable=False, default=0)
    revenue = Column(Integer, nullable=False, default=0)
    conversion_semantics = Column(String, nullable=False, default="total_plus_purchase")
    purchase_conversions = Column(Integer, nullable=False, default=0)
    purchase_revenue = Column(Integer, nullable=False, default=0)

    ctr = Column(Float, nullable=False, default=0.0)
    cpc = Column(Float, nullable=False, default=0.0)
    cvr = Column(Float, nullable=False, default=0.0)
    roas = Column(Float, nullable=False, default=0.0)

    source = Column(String, nullable=False, default="unknown")
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_ad_creative_date_campaign_adgroup", "date", "campaign_name", "adgroup_name"),
        Index("ix_ad_creative_creative_date", "creative_id", "date"),
        Index("ix_ad_creative_keyword_date", "display_keyword", "date"),
        Index("ix_ad_creative_source_date", "source", "date"),
    )


class NaverGfaDaily(Base):
    """
    Naver GFA(성과형 디스플레이 광고) 성과보고서 원천 일간 스냅샷.

    공식 OpenAPI 권한 없이도 광고센터의 성과보고서 다운로드 CSV/ZIP을 원천으로 삼는다.
    저장 단위는 보고서 조건상 소재 x 일자 x 게재위치 x 연령/성별이다.
    """

    __tablename__ = "naver_gfa_performance_daily"

    date = Column(Date, primary_key=True)
    campaign_id = Column(String, primary_key=True, default="")
    adgroup_id = Column(String, primary_key=True, default="")
    creative_id = Column(String, primary_key=True, default="")
    placement = Column(String, primary_key=True, default="")
    audience = Column(String, primary_key=True, default="")

    campaign_name = Column(String, nullable=False, default="")
    adgroup_name = Column(String, nullable=False, default="")
    creative_name = Column(String, nullable=False, default="")
    result_type = Column(String, nullable=True)
    cost_per_result_type = Column(String, nullable=True)
    started_on = Column(Date, nullable=True)
    ended_on = Column(String, nullable=True)

    results = Column(Integer, nullable=False, default=0)
    cost_per_result = Column(Float, nullable=False, default=0.0)
    impressions = Column(Integer, nullable=False, default=0)
    clicks = Column(Integer, nullable=False, default=0)
    cost = Column(Integer, nullable=False, default=0)
    conversions = Column(Integer, nullable=False, default=0)
    revenue = Column(Integer, nullable=False, default=0)
    cart_conversions = Column(Integer, nullable=False, default=0)
    cart_revenue = Column(Integer, nullable=False, default=0)
    purchase_conversions = Column(Integer, nullable=False, default=0)
    purchase_revenue = Column(Integer, nullable=False, default=0)

    cpm = Column(Float, nullable=False, default=0.0)
    ctr = Column(Float, nullable=False, default=0.0)
    cpc = Column(Float, nullable=False, default=0.0)
    cvr = Column(Float, nullable=False, default=0.0)
    roas = Column(Float, nullable=False, default=0.0)
    purchase_roas = Column(Float, nullable=False, default=0.0)

    source = Column(String, nullable=False, default="gfa_report_upload")
    raw_payload_json = Column(String, nullable=True)
    collected_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_naver_gfa_perf_campaign", "campaign_id", "date"),
        Index("ix_naver_gfa_perf_adgroup", "adgroup_id", "date"),
        Index("ix_naver_gfa_perf_creative", "creative_id", "date"),
        Index("ix_naver_gfa_perf_placement", "placement", "date"),
        Index("ix_naver_gfa_perf_audience", "audience", "date"),
    )


class NaverGfaCampaignInventory(Base):
    """
    GFA 광고센터 캠페인 목록 스냅샷.

    성과보고서에 등장하지 않는 0성과/미집행 캠페인까지 보존하기 위한
    광고센터 UI inventory 원천 테이블이다.
    """

    __tablename__ = "naver_gfa_campaign_inventory"

    ad_account_no = Column(String, primary_key=True, default="")
    campaign_type = Column(String, primary_key=True, default="")
    campaign_key = Column(String, primary_key=True, default="")

    campaign_id = Column(String, nullable=True)
    campaign_name = Column(String, nullable=False, default="")
    menu_label = Column(String, nullable=True)
    status = Column(String, nullable=True)
    onoff = Column(String, nullable=True)
    daily_budget = Column(String, nullable=True)
    objective = Column(String, nullable=True)
    raw_payload_json = Column(String, nullable=True)
    collected_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_gfa_campaign_inventory_type", "campaign_type"),
        Index("ix_gfa_campaign_inventory_name", "campaign_name"),
        Index("ix_gfa_campaign_inventory_status", "status"),
    )


class NaverGfaAdgroupInventory(Base):
    """
    GFA 광고센터 광고그룹 목록 스냅샷.

    성과보고서에 등장하지 않는 0성과/미집행 광고그룹까지 보존하기 위한
    광고센터 UI inventory 원천 테이블이다.
    """

    __tablename__ = "naver_gfa_adgroup_inventory"

    ad_account_no = Column(String, primary_key=True, default="")
    campaign_type = Column(String, primary_key=True, default="")
    adgroup_key = Column(String, primary_key=True, default="")

    campaign_id = Column(String, nullable=True)
    campaign_name = Column(String, nullable=False, default="")
    adgroup_id = Column(String, nullable=True)
    adgroup_name = Column(String, nullable=False, default="")
    menu_label = Column(String, nullable=True)
    status = Column(String, nullable=True)
    onoff = Column(String, nullable=True)
    daily_budget = Column(String, nullable=True)
    raw_payload_json = Column(String, nullable=True)
    collected_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_gfa_adgroup_inventory_type", "campaign_type"),
        Index("ix_gfa_adgroup_inventory_campaign", "campaign_name"),
        Index("ix_gfa_adgroup_inventory_name", "adgroup_name"),
        Index("ix_gfa_adgroup_inventory_status", "status"),
    )


class NaverGfaCreativeMeta(Base):
    """
    GFA 소재 해석용 사용자 입력 메타.

    성과보고서에는 소재 이미지/소구포인트가 안정적으로 포함되지 않으므로,
    소재 분석 화면에서 사용자가 업로드/태깅한 정보를 별도 보존한다.
    """

    __tablename__ = "naver_gfa_creative_meta"

    creative_id = Column(String, primary_key=True)
    creative_name = Column(String, nullable=False, default="")
    image_path = Column(String, nullable=True)
    appeal_points = Column(String, nullable=True)  # JSON array string
    image_type = Column(String, nullable=True)
    message_type = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )


class NaverGfaCreativeDetail(Base):
    """
    GFA 소재 상세 페이지(CDP)에서 자동 수집한 소재 컨디션.

    성과/게재위치 지표는 naver_gfa_performance_daily를 기준으로 두고,
    이 테이블은 이미지/카피/소재 타입 등 정적 조건만 보존한다.
    """

    __tablename__ = "naver_gfa_creative_detail"

    ad_account_no = Column(String, primary_key=True, default="")
    campaign_id = Column(String, primary_key=True, default="")
    adgroup_id = Column(String, primary_key=True, default="")
    creative_id = Column(String, primary_key=True, default="")

    detail_url = Column(String, nullable=False, default="")
    creative_name = Column(String, nullable=False, default="")
    creative_type = Column(String, nullable=True)
    profile_name = Column(String, nullable=True)
    profile_image_url = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    image_path = Column(String, nullable=True)
    primary_text = Column(String, nullable=True)
    headline = Column(String, nullable=True)
    description = Column(String, nullable=True)
    cta = Column(String, nullable=True)
    landing_url = Column(String, nullable=True)
    raw_payload_json = Column(String, nullable=True)
    content_hash = Column(String, nullable=True)
    last_error = Column(String, nullable=True)
    collected_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_gfa_creative_detail_creative", "creative_id"),
        Index("ix_gfa_creative_detail_hash", "content_hash"),
        Index("ix_gfa_creative_detail_collected", "collected_at"),
    )


class CreativeOrganicDerived(Base):
    """
    소재(AD) 일간 스냅샷(`naver_ad_creative_daily`)에 대해
    '4-2 상품 매칭/키워드/오가닉순위' 파생 결과를 저장하는 테이블.

    - 조회 시점 실시간 계산을 줄이고, 결과를 안정적으로 재사용하기 위함.
    - PK는 `naver_ad_creative_daily`와 동일 키(date+campaign+adgroup+creative+device)로 둔다.
    """

    __tablename__ = "creative_organic_rank_daily_derived"

    date = Column(Date, primary_key=True)
    campaign_name = Column(String, primary_key=True)
    adgroup_name = Column(String, primary_key=True)
    creative_id = Column(String, primary_key=True)
    device = Column(String, primary_key=True, default="ALL")

    # best-effort (조회 필터/디버그 가속용)
    ad_type = Column(String, nullable=True)

    match_status = Column(String, nullable=True)
    match_rule = Column(String, nullable=True)
    matched_product_url = Column(String, nullable=True)
    matched_product_title = Column(String, nullable=True)

    organic_keyword = Column(String, nullable=True)
    organic_rank = Column(Integer, nullable=True)
    organic_rank_source = Column(String, nullable=True)  # tracked_excel | openapi | none

    algo_version = Column(String, nullable=False, default="org_v1.0.0")
    computed_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_cre_org_date_campaign_adgroup", "date", "campaign_name", "adgroup_name"),
        Index("ix_cre_org_date_campaign", "date", "campaign_name"),
        Index("ix_cre_org_date_adgroup", "date", "adgroup_name"),
        Index("ix_cre_org_date_keyword", "date", "organic_keyword"),
        Index("ix_cre_org_url_keyword_date", "matched_product_url", "organic_keyword", "date"),
        Index("ix_cre_org_creative_date", "creative_id", "date"),
    )


class NaverGfaCreativeImageAnalysis(Base):
    """
    GFA 소재 이미지 자체에서 보이는 시각 요소 분석 결과.

    카피 문구 분석과 섞지 않고 이미지의 장면/인물/구도/제품 노출만 보존한다.
    """

    __tablename__ = "naver_gfa_creative_image_analysis"

    creative_id = Column(String, primary_key=True)
    image_url = Column(String, nullable=True)
    visual_subjects = Column(String, nullable=True)  # JSON array string
    hair_condition_tags = Column(String, nullable=True)  # JSON array string
    scene_tags = Column(String, nullable=True)  # JSON array string
    emotion_tags = Column(String, nullable=True)  # JSON array string
    composition_tags = Column(String, nullable=True)  # JSON array string
    color_mood_tags = Column(String, nullable=True)  # JSON array string
    product_visibility = Column(String, nullable=True)
    analysis_json = Column(String, nullable=True)
    confidence = Column(Float, nullable=False, default=0.0)
    model_name = Column(String, nullable=True)
    status = Column(String, nullable=False, default="generated")
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    analyzed_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_gfa_creative_image_analysis_status", "status"),
        Index("ix_gfa_creative_image_analysis_analyzed", "analyzed_at"),
    )


class NaverGfaCreativeCopyAnalysis(Base):
    """
    GFA 소재 작성 카피 문구 분석 결과.

    이미지 분석과 분리해 핵심 키워드/고객 고민/소구 방식/문장 톤만 보존한다.
    """

    __tablename__ = "naver_gfa_creative_copy_analysis"

    creative_id = Column(String, primary_key=True)
    primary_text = Column(String, nullable=True)
    headline = Column(String, nullable=True)
    description = Column(String, nullable=True)
    cta = Column(String, nullable=True)
    core_keywords = Column(String, nullable=True)  # JSON array string
    pain_points = Column(String, nullable=True)  # JSON array string
    appeal_types = Column(String, nullable=True)  # JSON array string
    message_tone = Column(String, nullable=True)
    cta_type = Column(String, nullable=True)
    analysis_json = Column(String, nullable=True)
    confidence = Column(Float, nullable=False, default=0.0)
    model_name = Column(String, nullable=True)
    status = Column(String, nullable=False, default="generated")
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    analyzed_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_gfa_creative_copy_analysis_status", "status"),
        Index("ix_gfa_creative_copy_analysis_analyzed", "analyzed_at"),
    )


class NaverGfaAnalysisResult(Base):
    """
    GFA 원본/전략 분석 산출물 저장소.

    캐시가 아니라 사용자가 실행한 기간/조건별 분석 결과 자체를 DB에 보존한다.
    같은 조건의 최신 결과는 is_latest=true로 표시하고, source_fingerprint로 원천 데이터 기준을 남긴다.
    """

    __tablename__ = "naver_gfa_analysis_result"

    analysis_id = Column(String, primary_key=True)
    latest_key = Column(String, nullable=False)
    analysis_type = Column(String, nullable=False)
    date_from = Column(Date, nullable=True)
    date_to = Column(Date, nullable=True)
    params_json = Column(String, nullable=False, default="{}")
    params_hash = Column(String, nullable=False)
    analysis_version = Column(String, nullable=False)
    source_fingerprint = Column(String, nullable=False)
    result_json = Column(String, nullable=False)
    row_count = Column(Integer, nullable=False, default=0)
    is_latest = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_gfa_analysis_result_latest", "latest_key", "is_latest"),
        Index("ix_gfa_analysis_result_type_dates", "analysis_type", "date_from", "date_to"),
        Index("ix_gfa_analysis_result_fingerprint", "source_fingerprint"),
        Index("ix_gfa_analysis_result_updated", "updated_at"),
    )


class NaverGfaStrategySnapshot(Base):
    """
    GFA 전략 도출 화면이 읽는 불변 전략 스냅샷.

    기존 naver_gfa_analysis_result는 기간/조건별 saved result 역할을 유지하고,
    이 테이블은 검증 후 발행된 PUBLISHED 결과만 UI 조회 기준선으로 사용한다.
    """

    __tablename__ = "naver_gfa_strategy_snapshot"

    snapshot_id = Column(String, primary_key=True)
    as_of_date = Column(Date, nullable=False)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    status = Column(String, nullable=False, default="BUILDING")
    analysis_version = Column(String, nullable=False)
    source_fingerprint = Column(String, nullable=False)
    source_result_id = Column(String, nullable=True)
    snapshot_origin = Column(String, nullable=False, default="BASELINE_PROMOTION")
    payload_json = Column(Text, nullable=True)
    payload_hash = Column(String, nullable=False)
    source_manifest_json = Column(Text, nullable=False, default="{}")
    validation_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    validated_at = Column(DateTime(timezone=True), nullable=True)
    published_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_gfa_strategy_snapshot_status", "status", "published_at"),
        Index("ix_gfa_strategy_snapshot_as_of", "as_of_date"),
        Index("ix_gfa_strategy_snapshot_source", "source_result_id", "snapshot_origin", unique=True),
        Index("ix_gfa_strategy_snapshot_payload_hash", "payload_hash"),
    )


class NaverGfaStrategySnapshotPointer(Base):
    """
    최신 PUBLISHED 전략 스냅샷 포인터.
    """

    __tablename__ = "naver_gfa_strategy_snapshot_pointer"

    pointer_key = Column(String, primary_key=True)
    snapshot_id = Column(String, nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_gfa_strategy_snapshot_pointer_snapshot", "snapshot_id"),
    )


class GfaBannerAnalysisHistory(Base):
    """
    신규 배너 이미지 업로드 분석 이력.

    운영 중인 GFA 소재 분석 원본과 분리해, 사용자가 직접 업로드한 신규 배너 검토 결과만 보존한다.
    """

    __tablename__ = "gfa_banner_analysis_history"

    history_id = Column(String, primary_key=True)
    filename = Column(String, nullable=False, default="")
    content_type = Column(String, nullable=False, default="")
    image_size_bytes = Column(Integer, nullable=False, default=0)
    image_base64 = Column(Text, nullable=True)
    note = Column(Text, nullable=True)
    model = Column(String, nullable=True)
    overall_score = Column(Float, nullable=False, default=0.0)
    grade = Column(String, nullable=True)
    verdict = Column(Text, nullable=True)
    result_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_gfa_banner_analysis_history_created", "created_at"),
        Index("ix_gfa_banner_analysis_history_score", "overall_score"),
    )


class NaverGfaCreativeGenerationRun(Base):
    """
    GFA 전략 분석 결과를 바탕으로 생성한 광고 이미지/카피/CTA 시안.

    원천 성과/분석 데이터와 생성물을 분리해, 어떤 분석 근거와 프롬프트로
    어떤 시안이 만들어졌는지 추적한다.
    """

    __tablename__ = "naver_gfa_creative_generation_run"

    id = Column(String, primary_key=True)
    batch_id = Column(String, nullable=True)
    candidate_index = Column(Integer, nullable=False, default=1)
    candidate_count = Column(Integer, nullable=False, default=1)
    goal = Column(String, nullable=False, default="")
    goal_label = Column(String, nullable=False, default="")
    template_type = Column(String, nullable=False, default="")
    template_label = Column(String, nullable=False, default="")
    source_creative_id = Column(String, nullable=True)
    source_creative_name = Column(String, nullable=True)

    source_snapshot_json = Column(String, nullable=True)
    guide_rules_json = Column(String, nullable=True)
    brief_json = Column(String, nullable=True)
    combination_strategy_json = Column(String, nullable=True)
    generation_explanation_json = Column(String, nullable=True)
    copy_prompt = Column(String, nullable=True)
    image_prompt = Column(String, nullable=True)
    copy_result_json = Column(String, nullable=True)

    image_path = Column(String, nullable=True)
    image_mime_type = Column(String, nullable=True)
    openai_model = Column(String, nullable=True)
    gemini_model = Column(String, nullable=True)
    status = Column(String, nullable=False, default="generated")
    error = Column(String, nullable=True)
    reviewer_status = Column(String, nullable=False, default="pending")
    reviewer_note = Column(String, nullable=True)
    usage_status = Column(String, nullable=False, default="not_used")
    used_campaign_name = Column(String, nullable=True)
    used_adgroup_name = Column(String, nullable=True)
    used_creative_name = Column(String, nullable=True)
    used_at = Column(DateTime(timezone=True), nullable=True)
    feedback_summary = Column(String, nullable=True)
    generation_source = Column(String, nullable=False, default="existing")
    appeal_point_id = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_gfa_creative_generation_batch", "batch_id"),
        Index("ix_gfa_creative_generation_goal", "goal"),
        Index("ix_gfa_creative_generation_source", "source_creative_id"),
        Index("ix_gfa_creative_generation_status", "status"),
        Index("ix_gfa_creative_generation_usage", "usage_status"),
        Index("ix_gfa_creative_generation_created", "created_at"),
        Index("ix_gfa_creative_generation_appeal", "appeal_point_id"),
        Index("ix_gfa_creative_generation_source_type", "generation_source"),
    )


class NaverGfaCreativeGenerationEvent(Base):
    """
    GFA 생성 소재의 생애주기 이벤트 로그.

    생성, 선택, 검수, 광고 소재 사용, 피드백 등 모든 행동을 append-only로 남겨
    시간이 지나도 어떤 후보가 왜 선택/폐기/사용됐는지 추적한다.
    """

    __tablename__ = "naver_gfa_creative_generation_event"

    event_id = Column(String, primary_key=True)
    run_id = Column(String, nullable=False)
    batch_id = Column(String, nullable=True)
    event_type = Column(String, nullable=False, default="")
    actor = Column(String, nullable=True)
    note = Column(String, nullable=True)
    payload_json = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_gfa_creative_generation_event_run", "run_id"),
        Index("ix_gfa_creative_generation_event_batch", "batch_id"),
        Index("ix_gfa_creative_generation_event_type", "event_type"),
        Index("ix_gfa_creative_generation_event_created", "created_at"),
    )


class ContentSkuScope(Base):
    """AI 콘텐츠 센터가 다루는 SKU 화이트리스트."""

    __tablename__ = "content_sku_scope"

    sku_id = Column(String, primary_key=True)
    product_url = Column(String, nullable=True)
    product_id_catalog = Column(BigInteger, nullable=True)
    title = Column(String, nullable=True)
    product_group = Column(String, nullable=False, default="other")  # henna | herb_pack | other
    phase1_enabled = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    alias_json = Column(String, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_content_sku_scope_group", "product_group"),
        Index("ix_content_sku_scope_phase1", "phase1_enabled"),
        Index("ix_content_sku_scope_pid", "product_id_catalog"),
    )


class ContentSkuAsset(Base):
    """AI 콘텐츠 센터에서 SKU별로 업로드한 제품/상세페이지 자산."""

    __tablename__ = "content_sku_asset"

    asset_id = Column(String, primary_key=True)
    sku_id = Column(String, nullable=False)
    product_url = Column(String, nullable=True)
    asset_type = Column(String, nullable=False, default="product_image")  # product_image | detail_page | reference_media
    asset_group_id = Column(String, nullable=True)
    group_name = Column(String, nullable=True)
    category = Column(String, nullable=True)
    keywords = Column(String, nullable=True)
    sku_ids = Column(String, nullable=True)
    filename = Column(String, nullable=False)
    original_filename = Column(String, nullable=True)
    mime_type = Column(String, nullable=True)
    file_path = Column(String, nullable=False)
    file_url = Column(String, nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    is_primary = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    analysis_status = Column(String, nullable=False, default="PENDING")
    analysis_json = Column(String, nullable=True)
    error_message = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_content_sku_asset_sku_type", "sku_id", "asset_type"),
        Index("ix_content_sku_asset_url_type", "product_url", "asset_type"),
        Index("ix_content_sku_asset_group_type", "asset_group_id", "asset_type"),
        Index("ix_content_sku_asset_category_type", "category", "asset_type"),
        Index("ix_content_sku_asset_primary", "sku_id", "asset_type", "is_primary"),
        Index("ix_content_sku_asset_created", "created_at"),
    )


class ContentProductInfo(Base):
    """AI 콘텐츠 센터에서 SKU별로 관리하는 제품 성분/원료 정보."""

    __tablename__ = "content_product_info"

    sku_id = Column(String, primary_key=True)
    product_url = Column(String, nullable=True)
    full_ingredients = Column(String, nullable=True)
    product_items_json = Column(String, nullable=True)
    ingredient_note = Column(String, nullable=True)
    source_note = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_content_product_info_url", "product_url"),
        Index("ix_content_product_info_updated", "updated_at"),
    )


class ContentInsight(Base):
    __tablename__ = "content_insight"

    insight_id = Column(String, primary_key=True)
    sku_id = Column(String, nullable=False)
    theme_key = Column(String, nullable=False, default="")
    problem = Column(String, nullable=False, default="")
    desire = Column(String, nullable=False, default="")
    barrier = Column(String, nullable=False, default="")
    motivation = Column(String, nullable=False, default="")
    usage_situation = Column(String, nullable=False, default="")
    customer_language_json = Column(String, nullable=True)
    trend = Column(String, nullable=False, default="new")  # new | strengthened | weakened
    evidence_count = Column(Integer, nullable=False, default=0)
    as_of_date = Column(Date, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_content_insight_sku_theme", "sku_id", "theme_key"),
        Index("ix_content_insight_date", "as_of_date"),
    )


class ContentAppealPoint(Base):
    __tablename__ = "content_appeal_point"

    appeal_id = Column(String, primary_key=True)
    sku_id = Column(String, nullable=False)
    insight_id = Column(String, nullable=True)
    theme_key = Column(String, nullable=False, default="")
    label = Column(String, nullable=False, default="")
    appeal_text = Column(String, nullable=False, default="")
    target = Column(String, nullable=True)
    demand_score = Column(Float, nullable=False, default=0.0)
    purchase_intent_score = Column(Float, nullable=False, default=0.0)
    evidence_score = Column(Float, nullable=False, default=0.0)
    conversion_score = Column(Float, nullable=False, default=0.0)
    novelty_score = Column(Float, nullable=False, default=0.0)
    freshness_score = Column(Float, nullable=False, default=0.0)
    overall_score = Column(Float, nullable=False, default=0.0)
    legal_risk = Column(String, nullable=False, default="LOW")
    claim_class = Column(String, nullable=False, default="MARKETING_INTERPRETATION")
    status = Column(String, nullable=False, default="ACTIVE")
    admin_review_status = Column(String, nullable=True)
    admin_review_note = Column(String, nullable=True)
    admin_reviewed_at = Column(DateTime(timezone=True), nullable=True)
    learning_verdict = Column(String, nullable=False, default="OBSERVE")
    as_of_date = Column(Date, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_content_appeal_sku_score", "sku_id", "overall_score"),
        Index("ix_content_appeal_status", "status"),
        Index("ix_content_appeal_theme", "theme_key"),
    )


class ContentAppealEvidence(Base):
    __tablename__ = "content_appeal_evidence"

    evidence_id = Column(String, primary_key=True)
    appeal_id = Column(String, nullable=False)
    insight_id = Column(String, nullable=True)
    sku_id = Column(String, nullable=False)
    source_type = Column(String, nullable=False, default="")
    source_pk = Column(String, nullable=False, default="")
    snippet = Column(String, nullable=False, default="")
    metric_json = Column(String, nullable=True)
    is_excluded = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    excluded_reason = Column(String, nullable=True)
    excluded_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_content_appeal_evidence_appeal", "appeal_id"),
        Index("ix_content_appeal_evidence_sku", "sku_id"),
        Index("ix_content_appeal_evidence_source", "source_type", "source_pk"),
    )


class ContentTopic(Base):
    __tablename__ = "content_topic"

    topic_id = Column(String, primary_key=True)
    sku_id = Column(String, nullable=False)
    appeal_id = Column(String, nullable=False)
    title = Column(String, nullable=False, default="")
    angle = Column(String, nullable=True)
    as_of_date = Column(Date, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (Index("ix_content_topic_sku_date", "sku_id", "as_of_date"),)


class ContentPlanItem(Base):
    __tablename__ = "content_plan_item"

    plan_id = Column(String, primary_key=True)
    plan_date = Column(Date, nullable=False)
    sku_id = Column(String, nullable=False)
    appeal_id = Column(String, nullable=False)
    topic_id = Column(String, nullable=True)
    channel = Column(String, nullable=False, default="")
    status = Column(String, nullable=False, default="queued")
    reason = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_content_plan_date_sku", "plan_date", "sku_id"),
        Index("ix_content_plan_appeal", "appeal_id"),
    )


class ContentArtifact(Base):
    __tablename__ = "content_artifact"

    artifact_id = Column(String, primary_key=True)
    parent_artifact_id = Column(String, nullable=True)
    original_artifact_id = Column(String, nullable=True)
    revision_no = Column(Integer, nullable=False, default=1)
    revision_reason = Column(String, nullable=True)
    source = Column(String, nullable=False, default="ai_original")
    is_published_version = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    plan_id = Column(String, nullable=True)
    sku_id = Column(String, nullable=False)
    appeal_id = Column(String, nullable=False)
    topic_id = Column(String, nullable=True)
    channel = Column(String, nullable=False, default="")
    title = Column(String, nullable=False, default="")
    body_json = Column(String, nullable=True)
    export_text = Column(String, nullable=True)
    gfa_run_id = Column(String, nullable=True)
    reviewer_status = Column(String, nullable=False, default="pending")
    reviewer_note = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_content_artifact_sku_channel", "sku_id", "channel"),
        Index("ix_content_artifact_appeal", "appeal_id"),
        Index("ix_content_artifact_status", "reviewer_status"),
        Index("ix_content_artifact_original", "original_artifact_id"),
        Index("ix_content_artifact_parent", "parent_artifact_id"),
        Index("ix_content_artifact_published", "is_published_version"),
    )


class ContentReviewEvent(Base):
    __tablename__ = "content_review_event"

    event_id = Column(String, primary_key=True)
    artifact_id = Column(String, nullable=False)
    event_type = Column(String, nullable=False, default="")
    actor = Column(String, nullable=True)
    note = Column(String, nullable=True)
    payload_json = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (Index("ix_content_review_event_artifact", "artifact_id"),)


class ContentPublishLink(Base):
    __tablename__ = "content_publish_link"

    link_id = Column(String, primary_key=True)
    artifact_id = Column(String, nullable=False)
    channel = Column(String, nullable=False, default="")
    published_url = Column(String, nullable=False, default="")
    published_external_id = Column(String, nullable=True)
    posted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (Index("ix_content_publish_link_artifact", "artifact_id"),)


class ContentPerformanceDaily(Base):
    __tablename__ = "content_performance_daily"

    perf_id = Column(String, primary_key=True)
    artifact_id = Column(String, nullable=False)
    appeal_id = Column(String, nullable=False)
    sku_id = Column(String, nullable=False)
    channel = Column(String, nullable=False, default="")
    metric_date = Column(Date, nullable=False)
    impressions = Column(Float, nullable=False, default=0.0)
    clicks = Column(Float, nullable=False, default=0.0)
    ctr = Column(Float, nullable=False, default=0.0)
    cvr = Column(Float, nullable=False, default=0.0)
    saves = Column(Float, nullable=False, default=0.0)
    shares = Column(Float, nullable=False, default=0.0)
    completion_rate = Column(Float, nullable=False, default=0.0)
    purchases = Column(Float, nullable=False, default=0.0)
    extra_json = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_content_perf_appeal_date", "appeal_id", "metric_date"),
        Index("ix_content_perf_artifact", "artifact_id"),
    )


class ContentGfaCreativeBinding(Base):
    __tablename__ = "content_gfa_creative_binding"

    binding_id = Column(String, primary_key=True)
    artifact_id = Column(String, nullable=False)
    gfa_run_id = Column(String, nullable=True)
    campaign_id = Column(String, nullable=True)
    campaign_name = Column(String, nullable=True)
    adgroup_id = Column(String, nullable=True)
    adgroup_name = Column(String, nullable=True)
    creative_id = Column(String, nullable=False)
    creative_name = Column(String, nullable=True)
    bound_by = Column(String, nullable=True)
    note = Column(String, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_content_gfa_binding_artifact", "artifact_id"),
        Index("ix_content_gfa_binding_creative", "creative_id"),
        Index("ix_content_gfa_binding_active", "is_active"),
    )


class ContentClaimPolicy(Base):
    __tablename__ = "content_claim_policy"

    policy_id = Column(String, primary_key=True)
    claim_class = Column(String, nullable=False, default="PROHIBITED")
    pattern = Column(String, nullable=False, default="")
    note = Column(String, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (Index("ix_content_claim_policy_class", "claim_class"),)


class NaverProductRankDaily(Base):
    """
    네이버 쇼핑 검색 결과에서 수집한 일자/키워드/상품 순위 스냅샷.

    - menu4(검색 순위 분석) 화면의 기본 데이터 소스로 사용한다.
    """

    __tablename__ = "naver_product_rank_daily"

    date = Column(Date, primary_key=True)
    keyword = Column(String, primary_key=True)
    rank = Column(Integer, primary_key=True)  # 1~50, 순위밖은 999 등 별도 값으로 저장

    product_title = Column(String, nullable=False, default="")
    mall_name = Column(String, nullable=False, default="")
    price = Column(Integer, nullable=False, default=0)
    purchase_cnt = Column(Integer, nullable=False, default=0)

    # OpenAPI 에서 제공되는 부가 정보
    # - 네이버 쇼핑 productId 는 32bit 정수를 초과하는 경우가 많아 BIGINT 로 저장한다.
    product_id = Column(BigInteger, nullable=True)
    # Host Agent shopping_rank_cdp: smartstore main/products/<ID> URL (순위 SoT)
    product_url = Column(String, nullable=True)
    image_url = Column(String, nullable=True)

    # 쇼핑 검색 API에서 제공되는 추가 메타 정보
    category1 = Column(String, nullable=True)
    category2 = Column(String, nullable=True)
    category3 = Column(String, nullable=True)
    category4 = Column(String, nullable=True)
    brand = Column(String, nullable=True)
    maker = Column(String, nullable=True)

    # CDP mobile organic shopping evidence fields. These preserve the exact
    # card condition used to decide whether a rank is valid.
    card_type = Column(String, nullable=True)
    source_type = Column(String, nullable=True)
    sas_type = Column(String, nullable=True)
    channel_product_id = Column(String, nullable=True)
    original_mall_product_id = Column(String, nullable=True)
    nv_mid = Column(BigInteger, nullable=True)
    rank_source = Column(String, nullable=True)
    card_json = Column(Text, nullable=True)

    is_our_brand = Column(Boolean, nullable=False, default=False)

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_product_rank_keyword_date", "keyword", "date"),
        Index("ix_product_rank_product_id_date", "product_id", "date"),
        Index("ix_product_rank_product_url_date", "product_url", "date"),
        Index("ix_product_rank_date_our_brand", "date", "is_our_brand"),
    )


class NaverProductReviewDaily(Base):
    """
    네이버 쇼핑 상품 리뷰/평점 일간 스냅샷.

    - 랭킹 수집과 동일한 keyword/product_id 기준으로, 날짜별 리뷰 요약치를 저장한다.
    """

    __tablename__ = "naver_product_review_daily"

    date = Column(Date, primary_key=True)
    keyword = Column(String, primary_key=True)
    # 랭킹 테이블과 동일하게 productId 는 BIGINT 로 관리한다.
    product_id = Column(BigInteger, primary_key=True)

    product_title = Column(String, nullable=False, default="")
    mall_name = Column(String, nullable=False, default="")

    rating_avg = Column(Float, nullable=False, default=0.0)
    rating_count = Column(Integer, nullable=False, default=0)

    rating_1_cnt = Column(Integer, nullable=False, default=0)
    rating_2_cnt = Column(Integer, nullable=False, default=0)
    rating_3_cnt = Column(Integer, nullable=False, default=0)
    rating_4_cnt = Column(Integer, nullable=False, default=0)
    rating_5_cnt = Column(Integer, nullable=False, default=0)

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )


class NaverReviewRaw(Base):
    """
    네이버 상품 리뷰 원문 저장 테이블.

    - 자동 답글 생성/리뷰 분석의 기준이 되는 "원문 텍스트"를 보관한다.
    - review_key 는 플랫폼 review_id 가 있으면 이를 쓰고, 없으면 안정 해시로 생성한다.
    """

    __tablename__ = "naver_review_raw"

    review_key = Column(String, primary_key=True)
    platform = Column(String, nullable=False, default="naver_smartstore")

    product_url = Column(String, nullable=False)
    product_title = Column(String, nullable=True)
    product_id_catalog = Column(BigInteger, nullable=True)
    keyword = Column(String, nullable=True)

    review_id_original = Column(String, nullable=True)
    review_written_at = Column(Date, nullable=True)
    rating = Column(Float, nullable=True)
    option_text = Column(String, nullable=True)
    review_text = Column(String, nullable=False, default="")
    reviewer_masked_id = Column(String, nullable=True)
    text_hash = Column(String, nullable=False, default="")
    import_source = Column(String, nullable=False, default="smartstore_product_page")
    reply_exists_flag = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    reply_collect_status = Column(String, nullable=True)
    raw_payload_json = Column(String, nullable=True)

    collected_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_naver_review_raw_product_url_written_at", "product_url", "review_written_at"),
        Index("ix_naver_review_raw_product_id_written_at", "product_id_catalog", "review_written_at"),
        Index("ix_naver_review_raw_review_id_original", "review_id_original"),
        Index("ix_naver_review_raw_reply_collect_status", "reply_collect_status"),
    )


class NaverReviewReplyRaw(Base):
    """
    리뷰에 달린 판매자 답글 원문 저장 테이블.

    - 현재 네이버 스마트스토어는 리뷰당 실질적으로 하나의 판매자 답글 상태를 추적하면 충분하므로,
      review_key 를 PK 로 두고 최신 상태를 덮어쓴다.
    """

    __tablename__ = "naver_review_reply_raw"

    review_key = Column(String, primary_key=True)
    reply_text = Column(String, nullable=True)
    reply_written_at = Column(Date, nullable=True)
    raw_payload_json = Column(String, nullable=True)

    collected_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )


class ReviewReplyDraft(Base):
    """
    GPT 기반 자동 답글 초안 저장 테이블.

    - 초안을 생성하고 바로 발송하지 않고, 상태(status)로 검토/재생성/실패를 추적한다.
    """

    __tablename__ = "review_reply_draft"

    draft_id = Column(String, primary_key=True)
    review_key = Column(String, nullable=False)
    status = Column(String, nullable=False, default="generated")
    draft_text = Column(String, nullable=False, default="")
    model_name = Column(String, nullable=True)
    prompt_version = Column(String, nullable=True)
    error_message = Column(String, nullable=True)
    style_level = Column(Integer, nullable=False, default=3)
    style_preset_id = Column(String, nullable=True)
    style_controls_json = Column(String, nullable=True)
    rejection_comment = Column(String, nullable=True)
    rejection_analyzed_at = Column(DateTime(timezone=True), nullable=True)
    rejection_analysis_json = Column(String, nullable=True)
    # Lineage: ORIGINAL_AI_DRAFT is immutable once set; draft_text holds the current (human edited) final.
    original_ai_text = Column(String, nullable=True)
    lineage_origin = Column(String, nullable=True)
    human_edit_count = Column(Integer, nullable=False, default=0, server_default=text("0"))
    human_edited_at = Column(DateTime(timezone=True), nullable=True)
    approved_text = Column(String, nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    published_text = Column(String, nullable=True)
    published_at = Column(DateTime(timezone=True), nullable=True)

    generated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_review_reply_draft_review_key", "review_key"),
        Index("ix_review_reply_draft_status", "status"),
    )


class ReviewReplyDraftRevision(Base):
    """Append-only lineage events: ORIGINAL_AI_DRAFT -> HUMAN_EDITED_FINAL -> APPROVED_REPLY -> PUBLISHED_REPLY."""

    __tablename__ = "review_reply_draft_revision"

    revision_id = Column(String, primary_key=True)
    draft_id = Column(String, nullable=False)
    review_key = Column(String, nullable=False)
    stage = Column(String, nullable=False)
    revision_text = Column(String, nullable=False, default="")
    text_sha256 = Column(String, nullable=False, default="")
    source = Column(String, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_review_reply_draft_revision_draft_id", "draft_id"),
        Index("ix_review_reply_draft_revision_review_key", "review_key"),
    )


class ReviewReplyBodyAudit(Base):
    """Audit trail for rejected or replaced invalid seller reply bodies. Never deleted."""

    __tablename__ = "review_reply_body_audit"

    audit_id = Column(String, primary_key=True)
    review_key = Column(String, nullable=True)
    review_id_original = Column(String, nullable=True)
    event = Column(String, nullable=False)
    body_verdict = Column(String, nullable=False)
    invalid_text = Column(String, nullable=True)
    replacement_text = Column(String, nullable=True)
    source = Column(String, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_review_reply_body_audit_review_key", "review_key"),
        Index("ix_review_reply_body_audit_event", "event"),
    )


class ReviewReplyKnowledgeValidation(Base):
    """Append-only human content validation of a historical reply. Authorship is never changed here."""

    __tablename__ = "review_reply_knowledge_validation"

    validation_id = Column(String, primary_key=True)
    knowledge_id = Column(String, nullable=False)
    review_key = Column(String, nullable=False)
    content_validation = Column(String, nullable=False)
    reply_appropriate = Column(String, nullable=True)
    guidance_accurate = Column(String, nullable=True)
    currently_valid = Column(String, nullable=True)
    reference_worthy = Column(String, nullable=True)
    note = Column(String, nullable=True)
    reviewer = Column(String, nullable=True)
    reviewer_uid = Column(String, nullable=True)
    reviewer_email = Column(String, nullable=True)
    reviewer_role = Column(String, nullable=True)
    knowhow_snapshot_json = Column(String, nullable=True)
    corpus_version = Column(String, nullable=True)
    authorship_class_at_validation = Column(String, nullable=True)
    reply_sha256_at_validation = Column(String, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_review_reply_knowledge_validation_knowledge_id", "knowledge_id"),
        Index("ix_review_reply_knowledge_validation_review_key", "review_key"),
    )


class ReviewReplyKnowledgeUnitFactValidation(Base):
    """Append-only human fact validation of one extracted guidance unit against registered official sources."""

    __tablename__ = "review_reply_knowledge_unit_fact_validation"

    unit_fact_validation_id = Column(String, primary_key=True)
    unit_key = Column(String, nullable=False)
    knowledge_id = Column(String, nullable=False)
    review_key = Column(String, nullable=False)
    reply_sha256_at_validation = Column(String, nullable=False)
    extraction_version = Column(String, nullable=False)
    source_span_start = Column(Integer, nullable=True)
    source_span_end = Column(Integer, nullable=True)
    unit_text = Column(String, nullable=False)
    unit_text_sha256 = Column(String, nullable=False)
    unit_snapshot_json = Column(String, nullable=False)
    fact_status = Column(String, nullable=False)
    statement_accurate = Column(String, nullable=True)
    product_applicable = Column(String, nullable=True)
    condition_accurate = Column(String, nullable=True)
    sequence_accurate = Column(String, nullable=True)
    numeric_accurate = Column(String, nullable=True)
    generator_reference_allowed = Column(String, nullable=True)
    evidence_json = Column(String, nullable=True)
    source_registry_version = Column(String, nullable=True)
    verified_scope = Column(String, nullable=True)
    hold_reason = Column(String, nullable=True)
    note = Column(String, nullable=True)
    reviewer_uid = Column(String, nullable=True)
    reviewer_email = Column(String, nullable=True)
    reviewer_role = Column(String, nullable=True)
    parent_authority_at_validation = Column(String, nullable=True)
    corpus_version = Column(String, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_rrk_unit_fact_validation_unit_key", "unit_key"),
        Index("ix_rrk_unit_fact_validation_knowledge_id", "knowledge_id"),
    )


class ReviewReplyKnowledgeSourceApplicability(Base):
    """Append-only Gate B (current product applicability) decision for one official entry x products x condition.

    Never updated or deleted; the effective state is derived at read time from the latest record per product.
    supersedes_record_id is the entry's latest record id seen by the reviewer ("ROOT" for the first) so two
    concurrent decisions on the same view cannot both be stored.
    """

    __tablename__ = "review_reply_knowledge_source_applicability"

    applicability_id = Column(String, primary_key=True)
    request_id = Column(String, nullable=False)
    request_payload_sha256 = Column(String, nullable=False)
    supersedes_record_id = Column(String, nullable=False)
    source_id = Column(String, nullable=False)
    source_version = Column(String, nullable=True)
    source_sha256 = Column(String, nullable=True)
    registry_version = Column(String, nullable=True)
    registry_file_sha256 = Column(String, nullable=True)
    entry_key = Column(String, nullable=False)
    entry_kind = Column(String, nullable=False)
    entry_content_sha256 = Column(String, nullable=False)
    original_text = Column(Text, nullable=False)
    source_location_json = Column(Text, nullable=True)
    gate_a_status = Column(String, nullable=True)
    decision = Column(String, nullable=False)
    products_json = Column(Text, nullable=False)
    skus_json = Column(Text, nullable=True)
    application_modes_json = Column(Text, nullable=True)
    condition = Column(Text, nullable=True)
    numeric_tokens_json = Column(Text, nullable=True)
    procedure_json = Column(Text, nullable=True)
    approved_fact_scope = Column(Text, nullable=True)
    limitations_exceptions = Column(Text, nullable=True)
    product_applicable = Column(String, nullable=True)
    usage_accurate = Column(String, nullable=True)
    exceptions_checked = Column(String, nullable=True)
    scope_clear = Column(String, nullable=True)
    company_standard_confirmed = Column(String, nullable=True)
    basis_type = Column(String, nullable=True)
    basis_reference = Column(Text, nullable=True)
    basis_summary = Column(Text, nullable=True)
    note = Column(Text, nullable=False)
    reviewer_uid = Column(String, nullable=True)
    reviewer_email = Column(String, nullable=True)
    reviewer_role = Column(String, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ux_rrk_source_applicability_request_id", "request_id", unique=True),
        Index("ux_rrk_source_applicability_chain", "source_id", "entry_key", "supersedes_record_id", unique=True),
        Index("ix_rrk_source_applicability_entry", "source_id", "entry_key"),
    )


class ReviewReplyKnowledgeClaimFactValidation(Base):
    """Append-only human fact validation of one claim split out of a composite guidance unit.

    Separate from unit fact records: a claim record never verifies its parent unit. supersedes_record_id is the claim's
    latest record id seen by the reviewer ("ROOT" for the first, never NULL) so two concurrent decisions on the same view
    cannot both be stored.
    """

    __tablename__ = "review_reply_knowledge_claim_fact_validation"

    claim_validation_id = Column(String, primary_key=True)
    request_id = Column(String, nullable=False)
    request_payload_sha256 = Column(String, nullable=False)
    supersedes_record_id = Column(String, nullable=False)
    claim_key = Column(String, nullable=False)
    claim_decomposition_version = Column(String, nullable=False)
    claim_text = Column(Text, nullable=False)
    claim_text_sha256 = Column(String, nullable=False)
    claim_spans_json = Column(Text, nullable=False)
    claim_snapshot_json = Column(Text, nullable=False)
    parent_unit_key = Column(String, nullable=False)
    parent_unit_text_sha256 = Column(String, nullable=False)
    knowledge_id = Column(String, nullable=False)
    review_key = Column(String, nullable=False)
    reply_sha256_at_validation = Column(String, nullable=False)
    fact_status = Column(String, nullable=False)
    statement_accurate = Column(String, nullable=True)
    product_applicable = Column(String, nullable=True)
    condition_accurate = Column(String, nullable=True)
    sequence_accurate = Column(String, nullable=True)
    numeric_accurate = Column(String, nullable=True)
    target_color_accurate = Column(String, nullable=True)
    official_color_label = Column(String, nullable=True)
    generator_reference_allowed = Column(String, nullable=False)
    evidence_json = Column(Text, nullable=True)
    source_registry_version = Column(String, nullable=True)
    verified_scope = Column(Text, nullable=True)
    hold_reason = Column(String, nullable=True)
    note = Column(Text, nullable=False)
    reviewer_uid = Column(String, nullable=True)
    reviewer_email = Column(String, nullable=True)
    reviewer_role = Column(String, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ux_rrk_claim_fact_validation_request_id", "request_id", unique=True),
        Index("ux_rrk_claim_fact_validation_chain", "claim_key", "supersedes_record_id", unique=True),
        Index("ix_rrk_claim_fact_validation_knowledge_id", "knowledge_id"),
        Index("ix_rrk_claim_fact_validation_parent", "parent_unit_key"),
    )


class ReviewReplyKnowledgePolicyDecision(Base):
    """Append-only admin policy decision for one guide-first question (D01~D13 and later questions).

    Never verifies replies or changes authorship. supersedes_record_id is the question's latest decision id seen by the
    admin ("ROOT" for the first) so two concurrent decisions on the same view cannot both be stored.
    """

    __tablename__ = "review_reply_knowledge_policy_decision"

    decision_id = Column(String, primary_key=True)
    request_id = Column(String, nullable=False)
    request_payload_sha256 = Column(String, nullable=False)
    supersedes_record_id = Column(String, nullable=False)
    question_id = Column(String, nullable=False)
    question_version = Column(String, nullable=False)
    question_sha256 = Column(String, nullable=False)
    decision = Column(String, nullable=False)
    decision_text = Column(Text, nullable=False)
    products_json = Column(Text, nullable=False)
    issue_ids_json = Column(Text, nullable=False)
    condition_key = Column(String, nullable=False)
    exceptions_json = Column(Text, nullable=False)
    evidence_json = Column(Text, nullable=False)
    source_registry_version = Column(String, nullable=True)
    linked_refs_json = Column(Text, nullable=False)
    note = Column(Text, nullable=False)
    reviewer_uid = Column(String, nullable=True)
    reviewer_email = Column(String, nullable=True)
    reviewer_role = Column(String, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ux_rrk_policy_decision_request_id", "request_id", unique=True),
        Index("ux_rrk_policy_decision_chain", "question_id", "supersedes_record_id", unique=True),
        Index("ix_rrk_policy_decision_question", "question_id"),
    )


class ReviewReplyFeedbackKnowledge(Base):
    __tablename__ = "review_reply_feedback_knowledge"

    knowledge_id = Column(String, primary_key=True)
    source_draft_id = Column(String, nullable=False)
    status = Column(String, nullable=False, default="active")
    problem_type = Column(String, nullable=True)
    problem_summary = Column(String, nullable=True)
    bad_pattern = Column(String, nullable=True)
    prevention_rule = Column(String, nullable=True)
    example_fix = Column(String, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_review_reply_feedback_knowledge_source_draft_id", "source_draft_id"),
        Index("ix_review_reply_feedback_knowledge_status", "status"),
    )


class CommerceQnaRaw(Base):
    """
    네이버 커머스 고객 문의 / 상품 문의 원문 스냅샷.

    - qna_kind:
      - customer: 고객 문의
      - product: 상품 문의
    - 외부 API의 답변 존재 여부(answered)와 내부 검수/제출 상태는 분리해서 다룬다.
    """

    __tablename__ = "commerce_qna_raw"

    qna_key = Column(String, primary_key=True)
    qna_kind = Column(String, nullable=False)
    platform = Column(String, nullable=False, default="naver_commerce")
    external_inquiry_id = Column(String, nullable=False)

    title = Column(String, nullable=True)
    category = Column(String, nullable=True)
    inquiry_text = Column(String, nullable=False, default="")
    inquiry_registered_at = Column(DateTime(timezone=True), nullable=True)

    answer_content_id = Column(String, nullable=True)
    answer_template_no = Column(String, nullable=True)
    answer_text = Column(String, nullable=True)
    answer_registered_at = Column(DateTime(timezone=True), nullable=True)
    answered = Column(Boolean, nullable=False, default=False, server_default=text("false"))

    order_id = Column(String, nullable=True)
    product_no = Column(String, nullable=True)
    product_order_id_list = Column(String, nullable=True)
    product_name = Column(String, nullable=True)
    product_order_option = Column(String, nullable=True)
    customer_id = Column(String, nullable=True)
    customer_name = Column(String, nullable=True)
    masked_writer_id = Column(String, nullable=True)

    raw_payload_json = Column(String, nullable=True)
    collected_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_commerce_qna_raw_kind_registered_at", "qna_kind", "inquiry_registered_at"),
        Index("ix_commerce_qna_raw_answered", "answered"),
        Index("ux_commerce_qna_raw_kind_external_id", "qna_kind", "external_inquiry_id", unique=True),
    )


class CommerceQnaDraft(Base):
    """
    Q&A 답변 초안 저장 테이블.

    상태 예시:
    - generated: 초안 생성됨
    - approved: 검수 승인됨
    - rejected: 반려됨
    - failed: 생성 실패 또는 시스템 실패
    - submitted: 외부 커머스 API 등록 완료
    - superseded: 더 최신 초안으로 대체됨
    """

    __tablename__ = "commerce_qna_draft"

    draft_id = Column(String, primary_key=True)
    qna_key = Column(String, nullable=False)
    status = Column(String, nullable=False, default="generated")
    draft_text = Column(String, nullable=False, default="")
    model_name = Column(String, nullable=True)
    prompt_version = Column(String, nullable=True)
    error_message = Column(String, nullable=True)
    rejection_comment = Column(String, nullable=True)
    rejection_analysis_json = Column(String, nullable=True)

    generated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_commerce_qna_draft_qna_key", "qna_key"),
        Index("ix_commerce_qna_draft_status", "status"),
    )


class CommerceQnaDraftValidation(Base):
    """
    Q&A 초안 자동 검증 결과 저장 테이블.

    - 드래프트 본문과 1:1로 대응되는 마지막 검증 결과를 보관한다.
    - 반려 사유(rejection)와 분리하여, 생성 직후 자동 품질 점검 상태를 구조적으로 추적한다.
    """

    __tablename__ = "commerce_qna_draft_validation"

    draft_id = Column(String, primary_key=True)
    qna_key = Column(String, nullable=False)
    check_status = Column(String, nullable=False, default="not_checked")
    initial_issues_json = Column(String, nullable=True)
    final_issues_json = Column(String, nullable=True)
    rewrite_attempted = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    rewrite_succeeded = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_commerce_qna_draft_validation_qna_key", "qna_key"),
        Index("ix_commerce_qna_draft_validation_status", "check_status"),
    )


class CommerceQnaFeedbackKnowledge(Base):
    __tablename__ = "commerce_qna_feedback_knowledge"

    knowledge_id = Column(String, primary_key=True)
    source_draft_id = Column(String, nullable=False)
    status = Column(String, nullable=False, default="active")
    qna_kind = Column(String, nullable=True)
    category = Column(String, nullable=True)
    problem_summary = Column(String, nullable=True)
    bad_pattern = Column(String, nullable=True)
    prevention_rule = Column(String, nullable=True)
    example_fix = Column(String, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_commerce_qna_feedback_knowledge_source_draft_id", "source_draft_id"),
        Index("ix_commerce_qna_feedback_knowledge_status", "status"),
    )


class CommerceQnaSubmitLog(Base):
    __tablename__ = "commerce_qna_submit_log"

    submit_id = Column(String, primary_key=True)
    qna_key = Column(String, nullable=False)
    draft_id = Column(String, nullable=False)
    qna_kind = Column(String, nullable=False)
    request_method = Column(String, nullable=False, default="POST")
    request_path = Column(String, nullable=False, default="")
    request_body_json = Column(String, nullable=True)
    response_status_code = Column(Integer, nullable=True)
    response_body_json = Column(String, nullable=True)
    remote_answer_content_id = Column(String, nullable=True)
    success = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    error_message = Column(String, nullable=True)
    submitted_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_commerce_qna_submit_log_qna_key", "qna_key"),
        Index("ix_commerce_qna_submit_log_draft_id", "draft_id"),
        Index("ix_commerce_qna_submit_log_success", "success"),
    )


class CommerceQnaAnalysis(Base):
    """
    Q&A 전문가 분석 결과 저장 테이블.

    - 원문(CommerceQnaRaw)과 분리해 재분석/재집계를 안전하게 수행한다.
    - qna_key 1건당 최신 분석 1건을 유지한다.
    """

    __tablename__ = "commerce_qna_analysis"

    analysis_id = Column(String, primary_key=True)
    qna_key = Column(String, nullable=False)
    qna_kind = Column(String, nullable=False, default="customer")
    inquiry_type = Column(String, nullable=True)
    inquiry_subtype = Column(String, nullable=True)
    purchase_stage = Column(String, nullable=True)
    sentiment = Column(String, nullable=True)
    urgency_level = Column(String, nullable=True)
    conversion_impact_level = Column(String, nullable=True)
    conversion_impact_score = Column(Float, nullable=False, default=0.0)
    complaint_flag = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    quality_issue_flag = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    marketing_signal_flag = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    faq_candidate_flag = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    competitor_mentioned_flag = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    competitor_name = Column(String, nullable=True)
    primary_need = Column(String, nullable=True)
    summary_text = Column(String, nullable=True)
    recommended_action = Column(String, nullable=True)
    confidence_score = Column(Float, nullable=False, default=0.0)
    model_name = Column(String, nullable=True)
    pipeline_version = Column(String, nullable=True)
    llm_used = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    analyzed_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ux_commerce_qna_analysis_qna_key", "qna_key", unique=True),
        Index("ix_commerce_qna_analysis_kind_stage", "qna_kind", "purchase_stage"),
        Index("ix_commerce_qna_analysis_sentiment", "sentiment"),
        Index("ix_commerce_qna_analysis_conversion_level", "conversion_impact_level"),
        Index("ix_commerce_qna_analysis_faq_candidate", "faq_candidate_flag"),
        Index("ix_commerce_qna_analysis_quality_issue", "quality_issue_flag"),
        Index("ix_commerce_qna_analysis_analyzed_at", "analyzed_at"),
    )


class CommerceQnaAnalysisKeyword(Base):
    __tablename__ = "commerce_qna_analysis_keyword"

    keyword_id = Column(Integer, primary_key=True, autoincrement=True)
    qna_key = Column(String, nullable=False)
    keyword = Column(String, nullable=False)
    keyword_type = Column(String, nullable=True)
    weight = Column(Float, nullable=False, default=1.0)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_commerce_qna_analysis_keyword_qna_key", "qna_key"),
        Index("ix_commerce_qna_analysis_keyword_keyword", "keyword"),
    )


class CommerceQnaAnalysisIssueTag(Base):
    __tablename__ = "commerce_qna_analysis_issue_tag"

    issue_tag_id = Column(Integer, primary_key=True, autoincrement=True)
    qna_key = Column(String, nullable=False)
    issue_tag = Column(String, nullable=False)
    severity = Column(String, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_commerce_qna_analysis_issue_tag_qna_key", "qna_key"),
        Index("ix_commerce_qna_analysis_issue_tag_tag", "issue_tag"),
    )


class NaverSmartstorePurchaseKeywordDaily(Base):
    """
    네이버 스마트스토어(판매) 기반 "구매 키워드" 일간 팩트 테이블.

    - 업로드(xlsx/csv)로 1일 단위로 적재하는 것을 기본으로 한다.
    - 같은 날짜/상품/채널/키워드 조합은 하나의 레코드로 유지(업서트)한다.
    """

    __tablename__ = "naver_smartstore_purchase_keyword_daily"

    date = Column(Date, primary_key=True)
    product_id = Column(BigInteger, primary_key=True)
    channel_group = Column(String, primary_key=True, default="")
    channel_name = Column(String, primary_key=True, default="")
    keyword = Column(String, primary_key=True, default="")

    # 상품/카테고리 메타(업로드 시점 스냅샷)
    category1 = Column(String, nullable=True)
    category2 = Column(String, nullable=True)
    category3 = Column(String, nullable=True)
    category4 = Column(String, nullable=True)
    product_name = Column(String, nullable=True)

    # 스마트스토어 "기여도 추정" 값은 소수(분배값)로 내려온다.
    # - 화면에서는 정수처럼 보일 수 있지만, 원본 값은 float이며 합계도 소수 기반으로 맞춰야 한다.
    # - Postgres에선 NUMERIC으로 보관해 합계/정렬 시 오차를 줄인다.
    payments = Column(Numeric(20, 6), nullable=False, default=0)  # 결제수(기여도)
    amount = Column(Numeric(20, 6), nullable=False, default=0)  # 결제금액(기여도)

    source = Column(String, nullable=False, default="purchase_upload")
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_ss_purchase_kw_date", "date"),
        Index("ix_ss_purchase_kw_date_product", "date", "product_id"),
        Index("ix_ss_purchase_kw_date_keyword", "date", "keyword"),
        Index("ix_ss_purchase_kw_channel", "channel_group", "channel_name"),
    )


class TrackedProductKeyword(Base):
    """
    메뉴4 '내 상품 추적' 기능에서 사용하는 추적 키워드 정의 테이블.

    - product_url: 추적 대상 상품 상세 페이지 URL (선택)
    - keyword: 네이버 쇼핑 검색 키워드
    - is_active: 현재 추적 여부
    """

    __tablename__ = "tracked_product_keyword"

    id = Column(Integer, primary_key=True, autoincrement=True)
    product_url = Column(String, nullable=True)
    keyword = Column(String, nullable=False)
    # 공식 엑셀 업로드에서 제공되는 월간 평균 검색량(키워드 옆 숫자)
    monthly_search_volume = Column(Integer, nullable=True)
    is_active = Column(Boolean, nullable=False, server_default=text("true"), default=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )


class TrackedProductManualKeyword(Base):
    """
    상세 화면에서 사용자가 직접 등록/업로드한 "수기 키워드(후보)" 메타 테이블.

    - 목적: 월검색량을 사용자 입력/엑셀로 영속 저장해, 메뉴 이동/새로고침 후에도 유지되도록 한다.
    - tracked_product_rank_daily(source='text')는 "일자별 순위 스냅샷"이고,
      본 테이블은 "키워드 리스트/월검색량" 같은 메타를 관리한다.

    PK: product_url + keyword
    """

    __tablename__ = "tracked_product_manual_keyword"

    product_url = Column(String, primary_key=True)
    keyword = Column(String, primary_key=True)

    monthly_search_volume = Column(Integer, nullable=True)
    monthly_search_volume_label = Column(String, nullable=True)

    is_active = Column(Boolean, nullable=False, server_default=text("true"), default=True)

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_tpmk_url_active", "product_url", "is_active"),
        Index("ix_tpmk_url_keyword", "product_url", "keyword"),
    )


class TrackedProductAutoKeyword(Base):
    """
    집중단계(자동 운영)에서 사용하는 추적 키워드 테이블.

    - product_url: 추적 대상 상품 URL
    - keyword: 네이버 쇼핑 검색 키워드
    - group_type: "core" | "watch"
    """

    __tablename__ = "tracked_product_auto_keyword"

    product_url = Column(String, primary_key=True)
    keyword = Column(String, primary_key=True)
    group_type = Column(String, nullable=False, default="watch")
    is_active = Column(Boolean, nullable=False, server_default=text("true"), default=True)

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_tpak_url_active", "product_url", "is_active"),
        Index("ix_tpak_url_group", "product_url", "group_type"),
        Index("ix_tpak_url_keyword", "product_url", "keyword"),
    )


class AdTrackedProduct(Base):
    """
    메뉴4 '내 광고 상품 추적'에서 사용하는 광고 진단 대상 상품 테이블.

    - 기존 오가닉 `tracked_product_*` 테이블과 분리해 광고 노출 진단 전용 설정을 보관한다.
    - product_url은 화면/수집에서 상품을 식별하는 기준이다.
    """

    __tablename__ = "ad_tracked_product"

    product_url = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    campaign_label = Column(String, nullable=True)
    is_active = Column(Boolean, nullable=False, server_default=text("true"), default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_ad_tracked_product_active", "is_active"),
        Index("ix_ad_tracked_product_updated", "updated_at"),
    )


class AdTrackedKeyword(Base):
    """
    광고 노출 진단 대상 키워드.
    """

    __tablename__ = "ad_tracked_keyword"

    id = Column(Integer, primary_key=True, autoincrement=True)
    product_url = Column(String, nullable=False)
    keyword = Column(String, nullable=False)
    is_active = Column(Boolean, nullable=False, server_default=text("true"), default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_ad_tracked_keyword_url_active", "product_url", "is_active"),
        Index("ix_ad_tracked_keyword_url_keyword", "product_url", "keyword"),
    )


class AdRankDiagnosisPreset(Base):
    """
    광고 노출 진단 조건 프리셋.

    - core: 매일/오전·오후 모니터링할 핵심 조건
    - expanded: 이상 감지 또는 수동 확장 시 사용할 전체 조건
    """

    __tablename__ = "ad_rank_diagnosis_preset"

    condition_id = Column(String, primary_key=True)
    gender = Column(String, nullable=False)
    age_band = Column(String, nullable=False)
    placement = Column(String, nullable=False)
    target_rank = Column(Integer, nullable=False, server_default=text("20"), default=20)
    scope = Column(String, nullable=False, default="core")
    is_active = Column(Boolean, nullable=False, server_default=text("true"), default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_ad_rank_diag_preset_scope", "scope", "is_active"),
        Index("ix_ad_rank_diag_preset_condition", "gender", "age_band", "placement"),
    )


class AdRankKeywordTargetRank(Base):
    """
    광고 노출 진단 기준 순위.

    실제 운영 기준은 "키워드 + 성별 + 연령 + 노출 지면" 단위다.
    예: 헤나 / 여성 / 45-49 / 통합검색 모바일 = 2위 이내
    """

    __tablename__ = "ad_rank_keyword_target_rank"

    keyword = Column(String, primary_key=True)
    gender = Column(String, primary_key=True)
    age_band = Column(String, primary_key=True)
    placement = Column(String, primary_key=True)
    target_rank = Column(Integer, nullable=False, server_default=text("20"), default=20)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_ad_rank_kw_target_keyword", "keyword"),
        Index("ix_ad_rank_kw_target_condition", "gender", "age_band", "placement"),
    )


class AdRankDiagnosisDaily(Base):
    """
    CDP 광고 노출 진단 결과 스냅샷.
    """

    __tablename__ = "ad_rank_diagnosis_daily"

    date = Column(Date, primary_key=True)
    time_slot = Column(String, primary_key=True, default="daily")
    product_url = Column(String, primary_key=True)
    keyword = Column(String, primary_key=True)
    gender = Column(String, primary_key=True)
    age_band = Column(String, primary_key=True)
    placement = Column(String, primary_key=True)

    visible = Column(Boolean, nullable=False, server_default=text("false"), default=False)
    rank = Column(Integer, nullable=True)
    competitor_count_above = Column(Integer, nullable=True)
    ad_type = Column(String, nullable=True)
    status = Column(String, nullable=False, default="pending")
    page_url = Column(String, nullable=True)
    raw_text_sample = Column(String, nullable=True)
    screenshot_path = Column(String, nullable=True)
    error = Column(String, nullable=True)
    collected_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_ad_rank_diag_daily_product_date", "product_url", "date"),
        Index("ix_ad_rank_diag_daily_keyword_date", "keyword", "date"),
        Index("ix_ad_rank_diag_daily_status", "status"),
    )


class TrackedCompetitorProduct(Base):
    """
    특정 추적 키워드에 매달린 경쟁 상품 정의 테이블.

    - tracked_keyword_id: 기준이 되는 TrackedProductKeyword.id
    - name: 화면에 표시할 경쟁 상품명 (예: 브랜드/상품명)
    - match_text: mall_name 또는 product_title 에 포함되는 텍스트(브랜드/몰명 등)
    - is_active: 현재 비교 대상 여부
    """

    __tablename__ = "tracked_competitor_product"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tracked_keyword_id = Column(Integer, nullable=False)
    name = Column(String, nullable=False)
    match_text = Column(String, nullable=False)
    is_active = Column(Boolean, nullable=False, server_default=text("true"), default=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )


class TrackedProductMeta(Base):
    """
    내 상품 추적에서 사용하는 URL 기준 상품 메타데이터 테이블.

    - product_url: SmartStore 등 실제 상품 상세 URL (정규화 없이 원본 그대로 저장, 트리밍만)
    - keyword: 마지막으로 메타를 가져올 때 사용한 대표 키워드
    - title / mall_name / image_url / price: shop.json 응답 기반 메타
    - product_id_catalog: 네이버 쇼핑 catalog productId (rank DB 의 product_id 와 동일 계열)
    - category1~4: shop.json 카테고리(같은 카테고리 상품 묶음/크롤링 스코프에 사용)
    """

    __tablename__ = "tracked_product_meta"

    id = Column(Integer, primary_key=True, autoincrement=True)
    product_url = Column(String, nullable=False, unique=True)

    keyword = Column(String, nullable=True)

    title = Column(String, nullable=True)
    mall_name = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    price = Column(Integer, nullable=True)
    product_id_catalog = Column(BigInteger, nullable=True)
    category1 = Column(String, nullable=True)
    category2 = Column(String, nullable=True)
    category3 = Column(String, nullable=True)
    category4 = Column(String, nullable=True)
    # 사용자 설정(상품별): 추적 키워드 운영 모드 (initial | focus)
    tracking_mode = Column(String, nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )


class A1SkuMap(Base):
    """
    A-1 자동화에서 사용하는 sku_id를 실제 상품(TrackedProductMeta.product_url / catalog productId)와 연결하기 위한 매핑 테이블.

    배경:
    - A-1 코어 테이블(sku_*_daily)은 sku_id(string) 기준으로만 저장된다.
    - 광고 지표/품질지수/상품 메타는 product_url 또는 catalog productId 기준으로 저장되는 경우가 많다.
    - 따라서 sku_id → (product_url, product_id_catalog) 매핑이 없으면 "광고 매출 기반 전략"을 결정론으로 계산할 수 없다.
    """

    __tablename__ = "a1_sku_map"

    sku_id = Column(String, primary_key=True)
    product_url = Column(String, nullable=True)
    product_id_catalog = Column(BigInteger, nullable=True)
    note = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_a1_sku_map_url", "product_url"),
        Index("ix_a1_sku_map_pid", "product_id_catalog"),
    )


class AnalyticsJobRun(Base):
    """
    배치/자동 동기화 작업의 실행 이력을 날짜 단위로 기록한다.

    - 4-2 화면 진입 시 자동 실행처럼 '하루 1회만' 돌리고 싶을 때 사용한다.
    - job_name + run_date 를 PK 로 두어 중복 실행을 DB 레벨에서 막는다.
    """

    __tablename__ = "analytics_job_run"

    job_name = Column(String, primary_key=True)
    run_date = Column(Date, primary_key=True)

    status = Column(String, nullable=False, default="STARTED")  # STARTED | SUCCESS | FAILED
    detail = Column(String, nullable=True)

    started_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    finished_at = Column(DateTime(timezone=True), nullable=True)


class CollectionTaskConfig(Base):
    """
    데이터 수집 허브의 작업 레지스트리/스케줄 설정.

    기존 메뉴별 수집 버튼과 자동 트리거를 중앙에서 관리하기 위한 최소 설정 테이블이다.
    """

    __tablename__ = "collection_task_config"

    task_id = Column(String, primary_key=True)
    label = Column(String, nullable=False)
    domain = Column(String, nullable=False)
    source_type = Column(String, nullable=False)  # server_api | server_batch | host_cdp | manual_import
    provider = Column(String, nullable=True)
    target_tables_json = Column(String, nullable=True)
    enabled = Column(Boolean, nullable=False, default=True)
    schedule_enabled = Column(Boolean, nullable=False, default=False)
    schedule_time = Column(String, nullable=True)
    freshness_days = Column(Integer, nullable=False, default=1)
    config_json = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))


class CollectionJobRun(Base):
    """
    데이터 수집 허브에서 실행한 개별 작업 이력.
    """

    __tablename__ = "collection_job_run"

    job_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id = Column(String, nullable=False, index=True)
    run_mode = Column(String, nullable=False, default="manual")  # manual | schedule | run_all | host_agent
    source_type = Column(String, nullable=False)
    status = Column(String, nullable=False, default="QUEUED")
    target_date = Column(Date, nullable=True)
    date_from = Column(Date, nullable=True)
    date_to = Column(Date, nullable=True)
    rows_written = Column(Integer, nullable=True)
    detail_json = Column(String, nullable=True)
    error = Column(String, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    finished_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_collection_job_task_started", "task_id", "started_at"),
        Index("ix_collection_job_status", "status"),
    )


class CollectionJobEvent(Base):
    """
    데이터 수집 작업의 진행/오류/로그 이벤트.
    """

    __tablename__ = "collection_job_event"

    event_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    job_id = Column(String, nullable=False, index=True)
    task_id = Column(String, nullable=False, index=True)
    level = Column(String, nullable=False, default="INFO")
    status = Column(String, nullable=True)
    message = Column(String, nullable=False)
    detail_json = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))


class NaverCommerceProductOrderRaw(Base):
    """
    네이버 커머스 API(주문/상품주문) 원천 스냅샷 저장 테이블.

    목적(구조적 안정성):
    - 집계 로직/필드 매핑이 바뀌어도 과거 데이터를 다시 집계할 수 있게 원천을 보존한다.
    - 단, 개인정보(배송지/연락처 등)는 저장하지 않도록 main에서 스냅샷을 정제한다.
    """

    __tablename__ = "naver_commerce_product_order_raw"

    product_order_id = Column(String, primary_key=True)  # 상품주문번호

    payment_date = Column(Date, nullable=True)
    order_date = Column(Date, nullable=True)

    product_id = Column(BigInteger, nullable=True)
    product_name = Column(String, nullable=True)
    quantity = Column(Integer, nullable=True)
    amount_paid = Column(Numeric(20, 6), nullable=True)

    inflow_path = Column(String, nullable=True)
    inflow_path_add = Column(String, nullable=True)

    last_changed_at = Column(DateTime(timezone=True), nullable=True)
    raw_json = Column(String, nullable=True)  # PII 제거된 스냅샷(JSON 문자열)

    fetched_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_commerce_po_payment_date", "payment_date"),
        Index("ix_commerce_po_order_date", "order_date"),
        Index("ix_commerce_po_product", "product_id"),
        Index("ix_commerce_po_inflow", "inflow_path", "inflow_path_add"),
    )


def upsert_naver_commerce_product_order_raw(records: list[dict]) -> int:
    """
    `naver_commerce_product_order_raw`에 idempotent upsert 한다.
    - 동일 product_order_id는 최신 fetched_at/필드로 갱신
    """
    if not records:
        return 0
    # 필수키가 없는 레코드는 제외
    cleaned: list[dict] = []
    for r in records:
        try:
            pid = str((r or {}).get("product_order_id") or "").strip()
        except Exception:
            pid = ""
        if not pid:
            continue
        rr = dict(r or {})
        rr["product_order_id"] = pid
        cleaned.append(rr)
    if not cleaned:
        return 0

    with SessionLocal() as session:
        stmt = insert(NaverCommerceProductOrderRaw).values(cleaned)
        update_cols: Iterable[str] = (
            c.name
            for c in NaverCommerceProductOrderRaw.__table__.columns
            if c.name
            not in (
                "product_order_id",
            )
        )
        # SQLite/Postgres 모두 on_conflict_do_update 지원(위에서 dialect별 insert 선택)
        upsert_stmt = stmt.on_conflict_do_update(
            index_elements=[NaverCommerceProductOrderRaw.product_order_id],
            set_={col: getattr(stmt.excluded, col) for col in update_cols},
        )
        res = session.execute(upsert_stmt)
        session.commit()
        try:
            return int(getattr(res, "rowcount", 0) or 0)
        except Exception:
            return len(cleaned)


class NaverCommerceProductSalesDaily(Base):
    """
    네이버 커머스(주문/상품주문) 기반 상품별 일별 판매 집계 테이블.

    설계 의도(구조적 안정성):
    - 원천(raw)이 누적/갱신되어도, 특정 일자 집계는 "그 시점의 raw 전체"로 재계산해 replace 저장한다.
    - source를 PK에 포함해, 동일 집계를 다른 소스(bizdata-stats 등)로 병행 저장할 수 있게 한다.
    """

    __tablename__ = "naver_commerce_product_sales_daily"

    date = Column(Date, primary_key=True)
    product_id = Column(BigInteger, primary_key=True)
    source = Column(String, primary_key=True, default="commerce_orders")

    product_name = Column(String, nullable=True)
    category_large = Column(String, nullable=True)
    category_middle = Column(String, nullable=True)
    category_small = Column(String, nullable=True)
    category_detail = Column(String, nullable=True)

    order_count = Column(Integer, nullable=False, default=0)
    quantity = Column(Integer, nullable=False, default=0)
    amount = Column(Numeric(20, 6), nullable=False, default=0)  # 결제금액 합(원)
    refund_order_count = Column(Integer, nullable=False, default=0)
    refund_quantity = Column(Integer, nullable=False, default=0)
    refund_amount = Column(Numeric(20, 6), nullable=False, default=0)

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_commerce_sales_date", "date"),
        Index("ix_commerce_sales_date_source", "date", "source"),
        Index("ix_commerce_sales_date_product", "date", "product_id"),
        Index("ix_commerce_sales_date_cat", "date", "category_large", "category_middle", "category_small"),
        Index("ix_commerce_sales_product", "product_id"),
    )


def replace_naver_commerce_product_sales_daily(
    *,
    target_date: date,
    records: list[dict],
    source: str = "commerce_orders",
) -> int:
    """
    특정 일자(target_date)의 상품별 판매 집계를 replace(동일 날짜+source 기존값 삭제 후 재적재)한다.

    - 운영: Postgres
    - 테스트: SQLite(in-memory)
    두 환경 모두에서 동작하도록 SQLAlchemy 표준 표현을 사용한다.
    """
    d = target_date
    src = str(source or "").strip() or "commerce_orders"

    # (안전) 동일 PK 중복이 들어와도 안정적으로 합쳐서 저장한다.
    # - Postgres는 같은 statement 안에 동일 PK가 중복되면 CardinalityViolation로 실패할 수 있다.
    merged: dict[tuple[str, int], dict] = {}
    for r in records or []:
        if not isinstance(r, dict):
            continue
        try:
            pid = int(r.get("product_id") or 0)
        except Exception:
            pid = 0
        if pid <= 0:
            continue

        key = (d.isoformat(), pid)
        cur = merged.get(key) or {
            "date": d,
            "product_id": pid,
            "source": src,
            "product_name": None,
            "category_large": None,
            "category_middle": None,
            "category_small": None,
            "category_detail": None,
            "order_count": 0,
            "quantity": 0,
            "amount": 0.0,
            "refund_order_count": 0,
            "refund_quantity": 0,
            "refund_amount": 0.0,
        }
        # product_name: 비어있지 않은 값 우선
        pn = str(r.get("product_name") or "").strip()
        if pn and not str(cur.get("product_name") or "").strip():
            cur["product_name"] = pn

        # category: 비어있지 않은 값 우선
        for ck in ("category_large", "category_middle", "category_small", "category_detail"):
            cv = str(r.get(ck) or "").strip()
            if cv and not str(cur.get(ck) or "").strip():
                cur[ck] = cv

        try:
            cur["order_count"] = int(cur.get("order_count") or 0) + int(r.get("order_count") or 0)
        except Exception:
            pass
        try:
            cur["quantity"] = int(cur.get("quantity") or 0) + int(r.get("quantity") or 0)
        except Exception:
            pass
        try:
            cur["amount"] = float(cur.get("amount") or 0.0) + float(r.get("amount") or 0.0)
        except Exception:
            pass
        try:
            cur["refund_order_count"] = int(cur.get("refund_order_count") or 0) + int(r.get("refund_order_count") or 0)
        except Exception:
            pass
        try:
            cur["refund_quantity"] = int(cur.get("refund_quantity") or 0) + int(r.get("refund_quantity") or 0)
        except Exception:
            pass
        try:
            cur["refund_amount"] = float(cur.get("refund_amount") or 0.0) + float(r.get("refund_amount") or 0.0)
        except Exception:
            pass

        merged[key] = cur

    cleaned = list(merged.values())

    with SessionLocal() as session:
        # replace semantics: 같은 날짜+source 기존 집계는 전부 삭제 후 재적재
        session.query(NaverCommerceProductSalesDaily).filter(
            NaverCommerceProductSalesDaily.date == d,
            NaverCommerceProductSalesDaily.source == src,
        ).delete(synchronize_session=False)
        session.commit()

        if not cleaned:
            return 0

        stmt = insert(NaverCommerceProductSalesDaily).values(cleaned)
        update_cols: Iterable[str] = (
            c.name
            for c in NaverCommerceProductSalesDaily.__table__.columns
            if c.name
            not in (
                "date",
                "product_id",
                "source",
                "created_at",
            )
        )
        upsert_stmt = stmt.on_conflict_do_update(
            index_elements=[
                NaverCommerceProductSalesDaily.date,
                NaverCommerceProductSalesDaily.product_id,
                NaverCommerceProductSalesDaily.source,
            ],
            set_={col: getattr(stmt.excluded, col) for col in update_cols},
        )
        res = session.execute(upsert_stmt)
        session.commit()
        try:
            return int(getattr(res, "rowcount", 0) or 0)
        except Exception:
            return len(cleaned)


class TrackedProductPageDaily(Base):
    """
    상품 상세 페이지(로그인 없이 접근 가능한 URL)에서 비공식적으로 수집한 '일자별' 스냅샷.

    - product_url 기준으로 관리하며, 하루 1회(또는 필요 시 강제) 갱신한다.
    """

    __tablename__ = "tracked_product_page_daily"

    date = Column(Date, primary_key=True)
    product_url = Column(String, primary_key=True)

    title = Column(String, nullable=True)
    price = Column(Integer, nullable=True)
    review_count = Column(Integer, nullable=True)
    rating = Column(Float, nullable=True)
    delivery = Column(String, nullable=True)
    buy_count = Column(Integer, nullable=True)
    # 찜 수(best-effort). 페이지 구조/차단에 따라 None일 수 있음.
    wish_count = Column(Integer, nullable=True)
    # 상품 등록일(best-effort). 페이지 구조/차단에 따라 None일 수 있음.
    registered_date = Column(Date, nullable=True)
    # 스마트스토어 상품 페이지에 잠깐 노출되는 구매/재구매 배지(best-effort)
    recent_purchase_count = Column(Integer, nullable=True)
    recent_purchase_window = Column(String, nullable=True)  # 예: "7d", "90d", "3m"
    # 판매정보(최근 구매 배지) 수집 상태(수집 완료 기준에 포함)
    recent_purchase_status = Column(String, nullable=True)
    # UI 출력용(정해진 2개 윈도우)
    # - 최근 1주간 구매 (7d) / 최근 3개월간 재구매 (3m)
    recent_purchase_7d_count = Column(Integer, nullable=True)
    recent_repurchase_count = Column(Integer, nullable=True)
    recent_repurchase_window = Column(String, nullable=True)
    recent_repurchase_3m_count = Column(Integer, nullable=True)
    recent_badge_text = Column(String, nullable=True)

    http_status = Column(Integer, nullable=True)
    error = Column(String, nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )


class TrackedProductSalesManual(Base):
    """
    네이버가 일부 상품에서 판매정보/배지를 제공하지 않는 경우를 대비한
    상품별 수기 입력(마지막 값) 저장 테이블.
    """

    __tablename__ = "tracked_product_sales_manual"

    product_url = Column(String, primary_key=True)  # 정규화된 base URL
    expected_sales_7d = Column(Integer, nullable=True)  # 건
    expected_revenue_7d_manwon = Column(Integer, nullable=True)  # 만원
    recent_purchase_1w_count = Column(Integer, nullable=True)  # 명(=건으로 표기 가능)
    recent_repurchase_3m_count = Column(Integer, nullable=True)  # 명(참고)
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )


class TrackedProductIndexManual(Base):
    """
    상품지수(점수화) 계산에 필요한 '수기 입력' 테이블.

    배경:
    - 클릭(조회수/찜), 최신성(등록 후 경과일), 패널티(지연/품절) 등은
      현재 자동 수집 파이프라인에서 항상 얻을 수 없으므로, 구조적으로 별도 테이블에 보존한다.
    - sales_7d는 page-metrics(최근 1주 구매 배지)나 product-sales-manual에서 자동/수기 보강될 수 있으나,
      필요 시 강제로 덮어쓸 수 있도록 override 필드를 둔다.
    """

    __tablename__ = "tracked_product_index_manual"

    # 정규화된 base URL 권장(기존 정책과 동일)
    product_url = Column(String, primary_key=True)

    weekly_views_7d = Column(Integer, nullable=True)  # 최근 7일 조회수(추정치 포함)
    wishes = Column(Integer, nullable=True)  # 찜 수

    sales_7d_override = Column(Integer, nullable=True)  # 최근 7일 판매량(override)
    sales_30d = Column(Integer, nullable=True)  # 최근 30일 판매량(추정/수기)

    days_since_reg = Column(Integer, nullable=True)  # 등록 후 경과일(수기/추정)
    delay_count = Column(Integer, nullable=True)  # 배송 지연 건수
    sold_out_days = Column(Integer, nullable=True)  # 품절 기간(일)

    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )


class TrackedProductIndexScoreDaily(Base):
    """
    상품지수(점수화) '일자별' 스냅샷 저장 테이블.

    요구사항:
    - 분석 결과는 매일 저장한다.
    - 전일 대비(이전 스냅샷 대비) 변화량을 UI에서 표시한다.
    """

    __tablename__ = "tracked_product_index_score_daily"

    date = Column(Date, primary_key=True)
    product_url = Column(String, primary_key=True)

    click_score = Column(Integer, nullable=False, default=0)  # 0~100
    sales_score = Column(Integer, nullable=False, default=0)  # 0~100
    review_score = Column(Integer, nullable=False, default=0)  # 0~100
    recency_score = Column(Integer, nullable=False, default=0)  # 0~100
    penalty_score = Column(Integer, nullable=False, default=0)  # 0~100 (차감용)

    final_score = Column(Integer, nullable=False, default=0)  # 0~100

    inputs_json = Column(String, nullable=True)  # 디버그/재현용(입력 스냅샷)

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_tpidx_score_url_date", "product_url", "date"),
    )


def upsert_tracked_product_sales_manual(
    db: Session,
    *,
    product_url: str,
    expected_sales_7d: int | None = None,
    expected_revenue_7d_manwon: int | None = None,
    recent_purchase_1w_count: int | None = None,
    recent_repurchase_3m_count: int | None = None,
) -> TrackedProductSalesManual:
    u = (product_url or "").strip()
    if not u:
        raise ValueError("product_url is required")
    row: TrackedProductSalesManual | None = (
        db.query(TrackedProductSalesManual)
        .filter(TrackedProductSalesManual.product_url == u)
        .one_or_none()
    )
    if row is None:
        row = TrackedProductSalesManual(product_url=u)
        db.add(row)
    row.expected_sales_7d = expected_sales_7d
    row.expected_revenue_7d_manwon = expected_revenue_7d_manwon
    row.recent_purchase_1w_count = recent_purchase_1w_count
    row.recent_repurchase_3m_count = recent_repurchase_3m_count
    # server_default만으로는 upsert 시점 갱신이 안 되므로 명시 갱신
    try:
        row.updated_at = datetime.utcnow()
    except Exception:
        pass
    db.commit()
    db.refresh(row)
    return row


class TrackedProductRankDaily(Base):
    """
    공식 엑셀 업로드로 저장하는 "내 상품" 키워드/일자별 순위 스냅샷.

    - product_url + keyword + date 를 PK 로 두어, 동일 셀(키워드×일자)을 안전하게 upsert 한다.
    - 기존 `naver_product_rank_daily`(PK: date+keyword+rank)와 충돌하지 않도록 별도 테이블로 관리한다.
    """

    __tablename__ = "tracked_product_rank_daily"

    date = Column(Date, primary_key=True)
    product_url = Column(String, primary_key=True)
    keyword = Column(String, primary_key=True)

    rank = Column(Integer, nullable=False, default=0)
    source = Column(String, nullable=False, default="excel")

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ix_tracked_rank_product_date", "product_url", "date"),
        Index("ix_tracked_rank_keyword_date", "keyword", "date"),
        Index("ix_tracked_rank_source_date", "source", "date"),
    )


def acquire_daily_job_run(session, *, job_name: str, run_date: date) -> bool:
    """
    동일 job_name/run_date 조합에 대해 최초 1회만 실행되도록 '락'을 획득한다.

    - 성공 시 True (이번 요청이 오늘 작업을 수행해야 함)
    - 실패(이미 존재) 시 False (오늘은 이미 수행되었으므로 skip 권장)
    """
    stmt = (
        insert(AnalyticsJobRun)
        .values(job_name=job_name, run_date=run_date, status="STARTED")
        .on_conflict_do_nothing(index_elements=[AnalyticsJobRun.job_name, AnalyticsJobRun.run_date])
    )
    res = session.execute(stmt)
    session.commit()
    return bool(getattr(res, "rowcount", 0))


def finish_daily_job_run(
    session,
    *,
    job_name: str,
    run_date: date,
    status: str,
    detail: str | None = None,
) -> None:
    now = datetime.utcnow()
    session.execute(
        text(
            "UPDATE analytics_job_run "
            "SET status = :status, detail = :detail, finished_at = :finished_at "
            "WHERE job_name = :job_name AND run_date = :run_date"
        ),
        {
            "status": status,
            "detail": detail,
            "finished_at": now,
            "job_name": job_name,
            "run_date": run_date,
        },
    )
    session.commit()


def upsert_tracked_product_page_daily(
    *,
    target_date: str,
    product_url: str,
    title: str | None,
    price: int | None,
    review_count: int | None,
    rating: float | None,
    delivery: str | None,
    buy_count: int | None,
    wish_count: int | None = None,
    registered_date: date | None = None,
    recent_purchase_count: int | None = None,
    recent_purchase_window: str | None = None,
    recent_purchase_status: str | None = None,
    recent_purchase_7d_count: int | None = None,
    recent_repurchase_count: int | None = None,
    recent_repurchase_window: str | None = None,
    recent_repurchase_3m_count: int | None = None,
    recent_badge_text: str | None = None,
    http_status: int | None = None,
    error: str | None = None,
) -> None:
    """
    `tracked_product_page_daily` 에 일자+URL 기준으로 upsert 한다.
    """
    d = _parse_date(target_date)
    normalized_url = (product_url or "").strip()
    record = {
        "date": d,
        "product_url": normalized_url,
        "title": title,
        "price": price,
        "review_count": review_count,
        "rating": rating,
        "delivery": delivery,
        "buy_count": buy_count,
        "wish_count": wish_count,
        "registered_date": registered_date,
        "recent_purchase_count": recent_purchase_count,
        "recent_purchase_window": recent_purchase_window,
        "recent_purchase_status": recent_purchase_status,
        "recent_purchase_7d_count": recent_purchase_7d_count,
        "recent_repurchase_count": recent_repurchase_count,
        "recent_repurchase_window": recent_repurchase_window,
        "recent_repurchase_3m_count": recent_repurchase_3m_count,
        "recent_badge_text": recent_badge_text,
        "http_status": http_status,
        "error": error,
    }
    with SessionLocal() as session:
        # 중요한 정책:
        # - 같은 날짜/URL에 대해 "유효 데이터(성공)"가 이미 저장된 상태라면,
        #   이후 캡차/차단/파싱실패 같은 "실패 결과"로 그 유효 데이터를 덮어쓰지 않는다.
        # - 사용자는 '한 번 수집되면 오늘은 계속 유지'를 기대하므로, UI 표기가 흔들리는 것을 방지한다.
        try:
            existing: TrackedProductPageDaily | None = (
                session.query(TrackedProductPageDaily)
                .filter(
                    TrackedProductPageDaily.date == d,
                    TrackedProductPageDaily.product_url == normalized_url,
                )
                .one_or_none()
            )
        except Exception:
            existing = None

        def _is_valid_success(_title, _price, _review_count, _rating, _http_status, _error) -> bool:
            """
            '성공(완료)' 기준(프론트/백엔드 수집 판정과 동일):
            - error 없음
            - http_status=200
            - review_count/rating 존재(null이 아님)
            - (추가로 title/price가 있을 수 있으나, 여기서는 핵심값 기준으로만 성공을 판단한다)
            """
            if _error is not None:
                return False
            if isinstance(_http_status, int) and _http_status != 200:
                return False
            return (_review_count is not None) and (_rating is not None)

        incoming_success = _is_valid_success(title, price, review_count, rating, http_status, error)
        existing_success = (
            (existing is not None)
            and _is_valid_success(
                existing.title,
                existing.price,
                existing.review_count,
                existing.rating,
                existing.http_status,
                existing.error,
            )
        )

        # 기존 성공 데이터가 있고, 이번 결과가 실패라면 업데이트를 스킵한다.
        # 단, "판매정보(구매/재구매 배지)"만 추가로 들어오는 경우는 예외로 허용한다.
        # (수기 입력/보조 수집 등으로 판매정보만 채우고 싶을 때, 기존 성공 데이터를 유지한 채 판매정보만 보강)
        incoming_sales_payload = (
            (record.get("recent_purchase_7d_count") is not None)
            or (record.get("recent_repurchase_3m_count") is not None)
            or (str(record.get("recent_purchase_status") or "").strip() == "collected")
        )
        # 커머스 API 등 "크롤링 없이도 수집 가능한 상품 메타"는,
        # 캡차/차단으로 page-metrics 본 수집이 실패하더라도 업데이트할 수 있어야 한다.
        incoming_meta_payload = (
            (record.get("title") is not None)
            or (record.get("price") is not None)
            or (record.get("delivery") is not None)
            or (record.get("registered_date") is not None)
        )
        if existing_success and not incoming_success:
            if not (existing is not None and (incoming_sales_payload or incoming_meta_payload)):
                return
            # 성공 판정에 영향을 주는 핵심 필드는 기존 성공값을 유지(덮어쓰기 방지).
            # 단, meta(title/price/delivery/registered_date)는 "들어온 값"이 있으면 업데이트를 허용한다.
            try:
                record["review_count"] = existing.review_count
                record["rating"] = existing.rating
                record["buy_count"] = existing.buy_count
                record["http_status"] = existing.http_status
                record["error"] = existing.error
                if record.get("title") is None:
                    record["title"] = existing.title
                if record.get("price") is None:
                    record["price"] = existing.price
                if record.get("delivery") is None:
                    record["delivery"] = existing.delivery
                if record.get("registered_date") is None:
                    record["registered_date"] = existing.registered_date
            except Exception:
                pass

        # 판매정보(최근 구매/재구매 배지)는 랜덤/일시 노출이라,
        # 이미 한 번 잡힌 값을 "다음 수집에서 None"으로 덮어써서 잃지 않게 한다.
        # - 특히 구매(최근 1주/3개월 등)는 연산/판정에 쓰이므로 보존이 중요하다.
        if existing is not None:
            try:
                if record.get("recent_purchase_count") is None and getattr(existing, "recent_purchase_count", None) is not None:
                    record["recent_purchase_count"] = existing.recent_purchase_count
                if not str(record.get("recent_purchase_window") or "").strip() and str(getattr(existing, "recent_purchase_window", "") or "").strip():
                    record["recent_purchase_window"] = existing.recent_purchase_window
                if record.get("recent_purchase_7d_count") is None and getattr(existing, "recent_purchase_7d_count", None) is not None:
                    record["recent_purchase_7d_count"] = existing.recent_purchase_7d_count
                # 찜 수는 랜덤/비노출/차단으로 None이 들어올 수 있으므로, 기존 값이 있으면 보존한다.
                if record.get("wish_count") is None and getattr(existing, "wish_count", None) is not None:
                    record["wish_count"] = existing.wish_count
                # 등록일은 정적값이므로, 기존 값이 있으면 보존한다.
                if record.get("registered_date") is None and getattr(existing, "registered_date", None) is not None:
                    record["registered_date"] = existing.registered_date
                # status는 collected가 최우선이므로, collected를 not_visible 등으로 덮어쓰지 않게 한다.
                incoming_status = str(record.get("recent_purchase_status") or "").strip()
                existing_status = str(getattr(existing, "recent_purchase_status", "") or "").strip()
                if (incoming_status == "" or incoming_status == "not_visible") and existing_status == "collected":
                    record["recent_purchase_status"] = "collected"

                if record.get("recent_repurchase_count") is None and getattr(existing, "recent_repurchase_count", None) is not None:
                    record["recent_repurchase_count"] = existing.recent_repurchase_count
                if not str(record.get("recent_repurchase_window") or "").strip() and str(getattr(existing, "recent_repurchase_window", "") or "").strip():
                    record["recent_repurchase_window"] = existing.repurchase_window if False else existing.recent_repurchase_window
                if record.get("recent_repurchase_3m_count") is None and getattr(existing, "recent_repurchase_3m_count", None) is not None:
                    record["recent_repurchase_3m_count"] = existing.recent_repurchase_3m_count

                if not str(record.get("recent_badge_text") or "").strip() and str(getattr(existing, "recent_badge_text", "") or "").strip():
                    record["recent_badge_text"] = existing.recent_badge_text
            except Exception:
                pass

        stmt = insert(TrackedProductPageDaily).values(record)
        update_cols: Iterable[str] = (
            c.name
            for c in TrackedProductPageDaily.__table__.columns
            if c.name not in ("date", "product_url", "created_at")
        )
        upsert_stmt = stmt.on_conflict_do_update(
            index_elements=[TrackedProductPageDaily.date, TrackedProductPageDaily.product_url],
            set_={col: getattr(stmt.excluded, col) for col in update_cols},
        )
        session.execute(upsert_stmt)
        session.commit()


def upsert_creative_organic_derived_many(
    session,
    *,
    records: list[dict],
) -> int:
    """
    `creative_organic_rank_daily_derived`에 파생 결과를 bulk upsert 한다.

    - Postgres: INSERT .. ON CONFLICT DO UPDATE 사용
    - 그 외(DB/테스트): session.merge 폴백

    반환: best-effort rowcount(정확하지 않을 수 있음)
    """
    if not records:
        return 0

    # normalize: primary keys는 항상 string trim을 적용해 충돌/중복을 줄인다.
    normed: list[dict] = []
    for r in records:
        if not isinstance(r, dict):
            continue
        rr = dict(r)
        rr["campaign_name"] = str(rr.get("campaign_name") or "").strip()
        rr["adgroup_name"] = str(rr.get("adgroup_name") or "").strip()
        rr["creative_id"] = str(rr.get("creative_id") or "").strip()
        rr["device"] = str(rr.get("device") or "ALL").strip() or "ALL"
        normed.append(rr)
    # `naver_ad_creative_daily` can contain several display_keyword rows for one
    # creative, while this derived table is keyed only by creative/device. Postgres
    # rejects duplicate ON CONFLICT keys within one bulk insert, so collapse them
    # before issuing the upsert. Keep the latest record from the caller.
    deduped: dict[tuple[object, str, str, str, str], dict] = {}
    for rr in normed:
        key = (
            rr.get("date"),
            str(rr.get("campaign_name") or ""),
            str(rr.get("adgroup_name") or ""),
            str(rr.get("creative_id") or ""),
            str(rr.get("device") or "ALL") or "ALL",
        )
        deduped[key] = rr
    normed = list(deduped.values())
    if not normed:
        return 0

    dialect = None
    try:
        dialect = session.get_bind().dialect.name  # type: ignore[attr-defined]
    except Exception:
        dialect = None

    if dialect == "postgresql":
        stmt = insert(CreativeOrganicDerived).values(normed)
        update_cols = {
            "ad_type": stmt.excluded.ad_type,
            "match_status": stmt.excluded.match_status,
            "match_rule": stmt.excluded.match_rule,
            "matched_product_url": stmt.excluded.matched_product_url,
            "matched_product_title": stmt.excluded.matched_product_title,
            "organic_keyword": stmt.excluded.organic_keyword,
            "organic_rank": stmt.excluded.organic_rank,
            "organic_rank_source": stmt.excluded.organic_rank_source,
            "algo_version": stmt.excluded.algo_version,
            "computed_at": stmt.excluded.computed_at,
        }
        stmt = stmt.on_conflict_do_update(
            index_elements=[
                CreativeOrganicDerived.date,
                CreativeOrganicDerived.campaign_name,
                CreativeOrganicDerived.adgroup_name,
                CreativeOrganicDerived.creative_id,
                CreativeOrganicDerived.device,
            ],
            set_=update_cols,
        )
        res = session.execute(stmt)
        return int(getattr(res, "rowcount", 0) or 0)

    # Fallback: merge per-row (슬로우, but 테스트/SQLite 환경 안전)
    cnt = 0
    for r in normed:
        try:
            session.merge(CreativeOrganicDerived(**r))
            cnt += 1
        except Exception:
            continue
    return cnt


def upsert_product_ranks_for_keyword(
    keyword: str,
    target_date: str,
    products: list[dict],
) -> int:
    """
    `NaverShoppingList` 등에서 수집한 상품 랭킹 데이터를 `naver_product_rank_daily` 에 upsert 한다.

    기대하는 product dict 필드:
      - rank: int (1~N, 순위밖은 별도 값)
      - product_title: str
      - mall_name: str
      - price: int
      - purchase_cnt: int
      - product_id: int | None
      - product_url: str | None  # smartstore main/products/<ID>
      - image_url: str | None
      - category1~4: str | None
      - brand: str | None
      - maker: str | None
      - card_type/source_type/sas_type: str | None
      - channel_product_id/original_mall_product_id: str | None
      - nv_mid: int | None
      - rank_source: str | None
      - card_json: str | None
      - is_our_brand: bool (선택, 기본 False)
    """
    if not products:
        return 0

    d = _parse_date(target_date)
    records: list[dict] = []

    for p in products:
        try:
            rnk = int(p.get("rank") or 0)
        except (TypeError, ValueError):
            continue

        title = str(p.get("product_title") or p.get("title") or "").strip()
        mall = str(p.get("mall_name") or p.get("mall") or "").strip()
        price = int(p.get("price") or 0)
        purchase_cnt = int(p.get("purchase_cnt") or p.get("purchaseCnt") or 0)
        product_id = p.get("product_id")
        product_url = str(p.get("product_url") or p.get("productUrl") or "").strip() or None
        image_url = p.get("image_url")
        category1 = (p.get("category1") or "").strip() or None
        category2 = (p.get("category2") or "").strip() or None
        category3 = (p.get("category3") or "").strip() or None
        category4 = (p.get("category4") or "").strip() or None
        brand = (p.get("brand") or "").strip() or None
        maker = (p.get("maker") or "").strip() or None
        card_type = (p.get("card_type") or p.get("cardType") or "").strip() or None
        source_type = (p.get("source_type") or p.get("sourceType") or "").strip() or None
        sas_type = (p.get("sas_type") or p.get("sasType") or "").strip() or None
        channel_product_id = str(p.get("channel_product_id") or p.get("channelProductId") or "").strip() or None
        original_mall_product_id = str(p.get("original_mall_product_id") or p.get("originalMallProductId") or "").strip() or None
        try:
            nv_mid = int(p.get("nv_mid") or p.get("nvMid") or 0) or None
        except (TypeError, ValueError):
            nv_mid = None
        rank_source = (p.get("rank_source") or p.get("rankSource") or "").strip() or None
        card_json = str(p.get("card_json") or p.get("cardJson") or "").strip() or None
        is_our_brand = bool(p.get("is_our_brand") or False)

        if not title and not product_url and product_id in (None, ""):
            continue
        if not title:
            title = product_url or str(product_id or "")

        records.append(
            {
                "date": d,
                "keyword": keyword,
                "rank": rnk,
                "product_title": title,
                "mall_name": mall,
                "price": price,
                "purchase_cnt": purchase_cnt,
                "product_id": product_id,
                "product_url": product_url,
                "image_url": image_url,
                "category1": category1,
                "category2": category2,
                "category3": category3,
                "category4": category4,
                "brand": brand,
                "maker": maker,
                "card_type": card_type,
                "source_type": source_type,
                "sas_type": sas_type,
                "channel_product_id": channel_product_id,
                "original_mall_product_id": original_mall_product_id,
                "nv_mid": nv_mid,
                "rank_source": rank_source,
                "card_json": card_json,
                "is_our_brand": is_our_brand,
            }
        )

    if not records:
        return 0

    with SessionLocal() as session:
        stmt = insert(NaverProductRankDaily).values(records)

        update_cols: Iterable[str] = (
            c.name
            for c in NaverProductRankDaily.__table__.columns
            if c.name not in ("date", "keyword", "rank", "created_at")
        )

        upsert_stmt = stmt.on_conflict_do_update(
            index_elements=[
                NaverProductRankDaily.date,
                NaverProductRankDaily.keyword,
                NaverProductRankDaily.rank,
            ],
            set_={col: getattr(stmt.excluded, col) for col in update_cols},
        )
        session.execute(upsert_stmt)
        session.commit()

    return len(records)


def upsert_product_reviews_for_keyword(
    *,
    keyword: str,
    target_date: str,
    product_id: int,
    product_title: str,
    mall_name: str,
    rating_avg: float,
    rating_count: int,
    rating_1_cnt: int,
    rating_2_cnt: int,
    rating_3_cnt: int,
    rating_4_cnt: int,
    rating_5_cnt: int,
) -> None:
    """
    외부 리뷰 수집 파이프라인에서 받아온 리뷰/평점 요약치를
    `naver_product_review_daily` 에 upsert 한다.
    """

    d = _parse_date(target_date)

    record = {
        "date": d,
        "keyword": keyword,
        "product_id": int(product_id),
        "product_title": product_title.strip(),
        "mall_name": mall_name.strip(),
        "rating_avg": float(rating_avg or 0.0),
        "rating_count": int(rating_count or 0),
        "rating_1_cnt": int(rating_1_cnt or 0),
        "rating_2_cnt": int(rating_2_cnt or 0),
        "rating_3_cnt": int(rating_3_cnt or 0),
        "rating_4_cnt": int(rating_4_cnt or 0),
        "rating_5_cnt": int(rating_5_cnt or 0),
    }

    with SessionLocal() as session:
        stmt = insert(NaverProductReviewDaily).values(record)
        update_cols: Iterable[str] = (
            c.name
            for c in NaverProductReviewDaily.__table__.columns
            if c.name not in ("date", "keyword", "product_id", "created_at")
        )
        upsert_stmt = stmt.on_conflict_do_update(
            index_elements=[
                NaverProductReviewDaily.date,
                NaverProductReviewDaily.keyword,
                NaverProductReviewDaily.product_id,
            ],
            set_={col: getattr(stmt.excluded, col) for col in update_cols},
        )
        session.execute(upsert_stmt)
        session.commit()


class AppSetting(Base):
    """
    앱 실행 중 변경 가능한 설정/시크릿 저장용 Key-Value 테이블.

    - 사용자가 Web UI에서 입력한 API 키 등을 Postgres에 저장해 컨테이너 재빌드 없이 반영할 수 있다.
    - key는 네임스페이스(prefix)를 포함해 충돌을 피한다. (예: "api:NAVER_KEY")
    """

    __tablename__ = "app_settings"

    key = Column(String, primary_key=True)
    value = Column(String, nullable=False, default="")
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )


class SeoCategoryDictionaryEntry(Base):
    """
    상품명 SEO/키워드 인사이트에서 공용으로 사용하는 카테고리 사전.

    - 브라우저 localStorage/IndexedDB 대신 서버 DB를 단일 진실로 사용한다.
    - (category_id, category_path)는 동일 항목으로 보고 중복 저장을 허용하지 않는다.
    """

    __tablename__ = "seo_category_dictionary_entry"

    entry_id = Column(Integer, primary_key=True, autoincrement=True)
    category_id = Column(String, nullable=False)
    category_path = Column(String, nullable=False)
    source_filename = Column(String, nullable=True)
    saved_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ux_seo_category_dictionary_entry_id_path", "category_id", "category_path", unique=True),
        Index("ix_seo_category_dictionary_entry_saved_at", "saved_at"),
    )


class SeoCategoryDictionaryUploadBatch(Base):
    __tablename__ = "seo_category_dictionary_upload_batch"

    batch_id = Column(String, primary_key=True)
    source_filename = Column(String, nullable=False)
    parsed_rows = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=False)
    uploaded_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    applied_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_seo_category_dictionary_upload_batch_uploaded_at", "uploaded_at"),
        Index("ix_seo_category_dictionary_upload_batch_is_active", "is_active"),
    )


class SeoCategoryDictionaryUploadEntry(Base):
    __tablename__ = "seo_category_dictionary_upload_entry"

    upload_entry_id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(String, nullable=False)
    category_id = Column(String, nullable=False)
    category_path = Column(String, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    __table_args__ = (
        Index("ux_seo_category_dictionary_upload_entry_batch_item", "batch_id", "category_id", "category_path", unique=True),
        Index("ix_seo_category_dictionary_upload_entry_batch_id", "batch_id"),
    )


def normalize_seo_category_dictionary_item(category_id: object, category_path: object) -> tuple[str, str]:
    cid = str(category_id or "").strip()
    raw_path = str(category_path or "").strip()
    if not cid or not re.fullmatch(r"\d+", cid):
        raise ValueError("category_id_must_be_digits")
    segs = [str(part or "").strip() for part in re.split(r"[>/]", raw_path) if str(part or "").strip()]
    if len(segs) < 2:
        raise ValueError("category_path_requires_at_least_two_segments")
    return cid, ">".join(segs)


def _seo_category_filename(filename: object) -> str:
    name = str(filename or "").strip()
    if not name:
        return "manual-entry"
    return name


def _list_upload_batch_rows(db: Session) -> list[SeoCategoryDictionaryUploadBatch]:
    _migrate_legacy_seo_category_dictionary_entries(db)
    return (
        db.query(SeoCategoryDictionaryUploadBatch)
        .order_by(
            SeoCategoryDictionaryUploadBatch.is_active.desc(),
            SeoCategoryDictionaryUploadBatch.uploaded_at.desc(),
            SeoCategoryDictionaryUploadBatch.batch_id.desc(),
        )
        .all()
    )


def _migrate_legacy_seo_category_dictionary_entries(db: Session) -> None:
    batch_exists = db.query(SeoCategoryDictionaryUploadBatch.batch_id).first()
    if batch_exists:
        return
    legacy_rows = (
        db.query(SeoCategoryDictionaryEntry)
        .order_by(
            SeoCategoryDictionaryEntry.saved_at.asc(),
            SeoCategoryDictionaryEntry.entry_id.asc(),
        )
        .all()
    )
    if not legacy_rows:
        return

    grouped: dict[tuple[str, str], list[SeoCategoryDictionaryEntry]] = {}
    for row in legacy_rows:
        uploaded_at = row.saved_at.isoformat() if row.saved_at else datetime.utcnow().isoformat()
        filename = str(row.source_filename or "").strip() or "legacy-import"
        grouped.setdefault((filename, uploaded_at), []).append(row)

    newest_key = None
    newest_at = None
    for key in grouped.keys():
        try:
            dt = datetime.fromisoformat(key[1])
        except Exception:
            dt = datetime.utcnow()
        if newest_at is None or dt > newest_at:
            newest_at = dt
            newest_key = key

    try:
        for idx, ((filename, uploaded_at_raw), rows) in enumerate(grouped.items(), start=1):
            try:
                uploaded_at = datetime.fromisoformat(uploaded_at_raw)
            except Exception:
                uploaded_at = datetime.utcnow()
            batch_id = f"legacy-{idx}"
            db.add(
                SeoCategoryDictionaryUploadBatch(
                    batch_id=batch_id,
                    source_filename=filename,
                    parsed_rows=len(rows),
                    is_active=((filename, uploaded_at_raw) == newest_key),
                    uploaded_at=uploaded_at,
                    applied_at=(uploaded_at if (filename, uploaded_at_raw) == newest_key else None),
                )
            )
            seen: set[tuple[str, str]] = set()
            for row in rows:
                key = (str(row.category_id or "").strip(), str(row.category_path or "").strip())
                if key in seen:
                    continue
                seen.add(key)
                db.add(
                    SeoCategoryDictionaryUploadEntry(
                        batch_id=batch_id,
                        category_id=key[0],
                        category_path=key[1],
                        created_at=uploaded_at,
                    )
                )
        db.commit()
    except Exception:
        db.rollback()
        raise


def list_seo_category_dictionary_entries(db: Session) -> dict:
    batch_rows = _list_upload_batch_rows(db)
    active_batch = next((row for row in batch_rows if bool(row.is_active)), None)
    entry_rows: list[SeoCategoryDictionaryUploadEntry] = []
    if active_batch is not None:
        entry_rows = (
            db.query(SeoCategoryDictionaryUploadEntry)
            .filter(SeoCategoryDictionaryUploadEntry.batch_id == active_batch.batch_id)
            .order_by(
                SeoCategoryDictionaryUploadEntry.category_path.asc(),
                SeoCategoryDictionaryUploadEntry.category_id.asc(),
            )
            .all()
        )
    items = [
        {
            "id": str(r.category_id or "").strip(),
            "path": str(r.category_path or "").strip(),
            "source_filename": (str(active_batch.source_filename or "").strip() or None) if active_batch else None,
            "saved_at": active_batch.uploaded_at.isoformat() if active_batch and active_batch.uploaded_at else None,
            "updated_at": active_batch.applied_at.isoformat() if active_batch and active_batch.applied_at else None,
        }
        for r in entry_rows
    ]

    latest_upload = None
    if batch_rows:
        latest = batch_rows[0]
        latest_upload = {
            "filename": str(latest.source_filename or "").strip() or None,
            "parsed_rows": int(latest.parsed_rows or 0),
            "saved_at": latest.uploaded_at.isoformat() if latest.uploaded_at else None,
        }

    files = [
        {
            "batch_id": row.batch_id,
            "filename": str(row.source_filename or "").strip(),
            "parsed_rows": int(row.parsed_rows or 0),
            "uploaded_at": row.uploaded_at.isoformat() if row.uploaded_at else None,
            "applied_at": row.applied_at.isoformat() if row.applied_at else None,
            "is_active": bool(row.is_active),
        }
        for row in batch_rows
    ]

    return {
        "items": items,
        "total": len(items),
        "latest_upload": latest_upload,
        "active_batch_id": active_batch.batch_id if active_batch else None,
        "files": files,
    }


def import_seo_category_dictionary_entries(db: Session, *, filename: str | None, items: list[dict]) -> dict:
    _migrate_legacy_seo_category_dictionary_entries(db)
    now = datetime.utcnow()
    filename0 = _seo_category_filename(filename)
    normalized: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for raw in items or []:
        cid, path = normalize_seo_category_dictionary_item(raw.get("id"), raw.get("path"))
        key = (cid, path)
        if key in seen:
            continue
        seen.add(key)
        normalized.append(key)

    if not normalized:
        raise ValueError("category_dictionary_items_required")

    try:
        db.query(SeoCategoryDictionaryUploadBatch).update({"is_active": False}, synchronize_session=False)
        batch_id = str(uuid.uuid4())
        db.add(
            SeoCategoryDictionaryUploadBatch(
                batch_id=batch_id,
                source_filename=filename0,
                parsed_rows=len(normalized),
                is_active=True,
                uploaded_at=now,
                applied_at=now,
            )
        )
        to_insert = [
            {
                "batch_id": batch_id,
                "category_id": cid,
                "category_path": path,
                "created_at": now,
            }
            for cid, path in normalized
        ]
        if to_insert:
            stmt = insert(SeoCategoryDictionaryUploadEntry).values(to_insert)
            dialect = str(getattr(getattr(db, "bind", None), "dialect", None).name or "").lower()
            if dialect in {"sqlite", "postgresql"}:
                stmt = stmt.on_conflict_do_nothing(index_elements=["batch_id", "category_id", "category_path"])
            db.execute(stmt)
        db.commit()
    except Exception:
        db.rollback()
        raise

    total_active = (
        db.query(SeoCategoryDictionaryUploadEntry)
        .filter(SeoCategoryDictionaryUploadEntry.batch_id == batch_id)
        .count()
    )
    return {
        "parsed": len(normalized),
        "inserted": len(normalized),
        "skipped": 0,
        "total_active": int(total_active or 0),
        "saved_at": now.isoformat(),
        "filename": filename0,
        "batch_id": batch_id,
    }


def apply_seo_category_dictionary_batch(db: Session, *, batch_id: object) -> dict:
    _migrate_legacy_seo_category_dictionary_entries(db)
    bid = str(batch_id or "").strip()
    if not bid:
        raise ValueError("batch_id_required")
    row = db.query(SeoCategoryDictionaryUploadBatch).filter(SeoCategoryDictionaryUploadBatch.batch_id == bid).one_or_none()
    if row is None:
        raise ValueError("batch_not_found")
    now = datetime.utcnow()
    try:
        db.query(SeoCategoryDictionaryUploadBatch).update({"is_active": False}, synchronize_session=False)
        row.is_active = True
        row.applied_at = now
        db.commit()
    except Exception:
        db.rollback()
        raise
    total_active = (
        db.query(SeoCategoryDictionaryUploadEntry)
        .filter(SeoCategoryDictionaryUploadEntry.batch_id == bid)
        .count()
    )
    return {
        "batch_id": bid,
        "filename": str(row.source_filename or "").strip(),
        "total_active": int(total_active or 0),
        "applied_at": now.isoformat(),
    }


def delete_seo_category_dictionary_batch(db: Session, *, batch_id: object) -> dict:
    _migrate_legacy_seo_category_dictionary_entries(db)
    bid = str(batch_id or "").strip()
    if not bid:
        raise ValueError("batch_id_required")
    row = db.query(SeoCategoryDictionaryUploadBatch).filter(SeoCategoryDictionaryUploadBatch.batch_id == bid).one_or_none()
    if row is None:
        raise ValueError("batch_not_found")
    was_active = bool(row.is_active)
    try:
        deleted_entries = (
            db.query(SeoCategoryDictionaryUploadEntry)
            .filter(SeoCategoryDictionaryUploadEntry.batch_id == bid)
            .delete(synchronize_session=False)
        )
        db.query(SeoCategoryDictionaryUploadBatch).filter(SeoCategoryDictionaryUploadBatch.batch_id == bid).delete(synchronize_session=False)
        db.flush()
        if was_active:
            fallback = (
                db.query(SeoCategoryDictionaryUploadBatch)
                .order_by(SeoCategoryDictionaryUploadBatch.uploaded_at.desc(), SeoCategoryDictionaryUploadBatch.batch_id.desc())
                .first()
            )
            if fallback is not None:
                fallback.is_active = True
                fallback.applied_at = datetime.utcnow()
        db.commit()
        active_batch = db.query(SeoCategoryDictionaryUploadBatch).filter(SeoCategoryDictionaryUploadBatch.is_active.is_(True)).one_or_none()
        total_active = (
            db.query(SeoCategoryDictionaryUploadEntry)
            .filter(SeoCategoryDictionaryUploadEntry.batch_id == active_batch.batch_id)
            .count()
            if active_batch is not None
            else 0
        )
        return {
            "deleted": 1,
            "deleted_entries": int(deleted_entries or 0),
            "total_active": int(total_active or 0),
            "active_batch_id": active_batch.batch_id if active_batch is not None else None,
        }
    except Exception:
        db.rollback()
        raise


def delete_seo_category_dictionary_entry(db: Session, *, category_id: object, category_path: object) -> int:
    cid, path = normalize_seo_category_dictionary_item(category_id, category_path)
    try:
        deleted = (
            db.query(SeoCategoryDictionaryEntry)
            .filter(
                SeoCategoryDictionaryEntry.category_id == cid,
                SeoCategoryDictionaryEntry.category_path == path,
            )
            .delete(synchronize_session=False)
        )
        db.commit()
        return int(deleted or 0)
    except Exception:
        db.rollback()
        raise


class AiDecisionLog(Base):
    """
    AI 분석 결과(판단 로그) 저장 테이블.

    목적:
    - 재현성/감사/학습을 위해 "입력 스냅샷 + 판단 결과"를 구조적으로 저장한다.

    스키마(요약):
    - analysis_type: 예) "A-1"
    - entity_type: 예) "SKU" | "keyword" 등
    - entity_id: 예) "product_url||keyword"
    - inputs_hash: 입력 스냅샷 해시(중복/캐시 판별)
    - inputs_json: 입력 스냅샷(JSON 문자열)
    - decision/confidence/rules_triggered/recommended_actions: 구조화된 결과(JSON 문자열 포함)
    - analysis_text: 모델의 전체 분석 결과(Markdown/텍스트)
    """

    __tablename__ = "ai_decision_log"

    log_id = Column(String, primary_key=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    analysis_type = Column(String, nullable=False)
    entity_type = Column(String, nullable=False)
    entity_id = Column(String, nullable=False)

    inputs_hash = Column(String, nullable=False)
    inputs_json = Column(String, nullable=False, default="")

    decision = Column(String, nullable=True)
    rules_triggered = Column(String, nullable=True)  # JSON 문자열(배열)
    confidence = Column(Float, nullable=True)
    recommended_actions = Column(String, nullable=True)  # JSON 문자열
    analysis_text = Column(String, nullable=False, default="")

    human_override = Column(String, nullable=True)  # 예: approve/reject/edited
    result_followup = Column(String, nullable=True)  # 7일 후 성과 비교 등(후속 기록)

    __table_args__ = (
        Index("ix_ai_log_type_entity_time", "analysis_type", "entity_type", "entity_id", "created_at"),
        Index("ix_ai_log_inputs_hash", "analysis_type", "entity_id", "inputs_hash"),
    )


# -----------------------------
# AI 운영 센터 공통 테이블
# - 상품 단위 판단 스냅샷과 사람 검토용 실행 큐를 분리한다.
# - SQLite(테스트)에서도 동작하도록 JSONB 대신 TEXT(JSON 문자열)로 저장한다.
# -----------------------------


class DecisionProductHealthDaily(Base):
    """
    SKU/상품 단위의 일간 운영 판단 스냅샷.
    - 광고/오가닉/판매/VOC/Q&A/트렌드 신호를 하나의 판단 행으로 정리한다.
    - 운영 UI는 "오늘 기준 어떤 SKU를 먼저 만질지"를 이 테이블로 조회한다.
    """

    __tablename__ = "decision_product_health_daily"

    date = Column(Date, primary_key=True)
    sku_id = Column(String, primary_key=True)

    product_url = Column(String, nullable=True)
    product_id_catalog = Column(BigInteger, nullable=True)
    product_name = Column(String, nullable=True)

    policy_type = Column(String, nullable=True)
    top_issue = Column(String, nullable=True)

    priority_score = Column(Float, nullable=False, default=0.0)
    confidence_score = Column(Float, nullable=False, default=0.0)
    data_quality_score = Column(Float, nullable=False, default=0.0)

    organic_strength_score = Column(Float, nullable=True)
    ad_efficiency_score = Column(Float, nullable=True)
    sales_growth_score = Column(Float, nullable=True)
    review_risk_score = Column(Float, nullable=True)
    qna_barrier_score = Column(Float, nullable=True)
    trend_momentum_score = Column(Float, nullable=True)

    recommended_action_primary = Column(String, nullable=True)
    recommended_actions_json = Column(String, nullable=True)
    evidence_json = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_decision_product_health_date_priority", "date", "priority_score"),
        Index("ix_decision_product_health_date_policy", "date", "policy_type"),
        Index("ix_decision_product_health_sku_date", "sku_id", "date"),
    )


class ActionQueueItem(Base):
    """
    AI가 제안한 액션을 사람이 검토/승인하는 실행 큐.
    - 즉시 자동 실행하지 않고, 운영자가 상태를 바꾸며 이력을 남긴다.
    """

    __tablename__ = "action_queue"

    queue_id = Column(String, primary_key=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    source_scope = Column(String, nullable=False, default="ai-ops")
    entity_type = Column(String, nullable=False, default="sku")
    entity_id = Column(String, nullable=False, default="")
    action_type = Column(String, nullable=False, default="")

    payload_json = Column(String, nullable=False, default="{}")
    priority = Column(String, nullable=False, default="P3")  # P1 | P2 | P3
    status = Column(String, nullable=False, default="PENDING")  # PENDING | APPROVED | REJECTED | DONE

    reviewer = Column(String, nullable=True)
    review_note = Column(String, nullable=True)

    __table_args__ = (
        Index("ix_action_queue_status_priority_created", "status", "priority", "created_at"),
        Index("ix_action_queue_entity_created", "entity_type", "entity_id", "created_at"),
        Index("ix_action_queue_source_created", "source_scope", "created_at"),
    )


# -----------------------------
# A-1 오가닉 운영 자동화(배치)용 테이블
# - Postgres 운영에서는 api/prisma/sql 의 DDL/Upsert로 관리하되,
#   Analytics API(테스트/로컬)에서는 ORM 모델을 제공해 조회/저장을 단순화한다.
# - SQLite(테스트)에서도 동작하도록 JSONB 대신 TEXT(JSON 문자열)로 저장한다.
# -----------------------------


class A1SkuZoneCountsDaily(Base):
    """
    SKU별 판정 키워드(Decision keyword) 순위 구간 집계(전일 스냅샷).
    - zone 정의: 1~3 / 4~6 / 7~10 / 11~15 / 16+ 또는 없음(999/NULL)
    """

    __tablename__ = "sku_zone_counts_daily"

    date = Column(Date, primary_key=True)
    surface = Column(String, primary_key=True)
    sku_id = Column(String, primary_key=True)

    decision_kw_total = Column(Integer, nullable=False, default=0)
    top1_3_kw_cnt = Column(Integer, nullable=False, default=0)
    top4_6_kw_cnt = Column(Integer, nullable=False, default=0)
    top7_10_kw_cnt = Column(Integer, nullable=False, default=0)
    top11_15_kw_cnt = Column(Integer, nullable=False, default=0)
    below16_kw_cnt = Column(Integer, nullable=False, default=0)
    avg_rank_decision_kw = Column(Float, nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_a1_zone_date_surface", "date", "surface"),
        Index("ix_a1_zone_surface_sku_date", "surface", "sku_id", "date"),
    )


class A1SkuStateDaily(Base):
    """
    SKU 상태(State) 일별 판정 결과.
    - VERY_STABLE / STABLE_DEFENSE / RISK_RECOVERY / GROWTH_NEEDED / REFERENCE_ONLY 등
      (운영 규격은 docs/AI_A1_ANALYSIS_DEV_NOTE.md 참조)
    """

    __tablename__ = "sku_state_daily"

    date = Column(Date, primary_key=True)
    surface = Column(String, primary_key=True)
    sku_id = Column(String, primary_key=True)

    state = Column(String, nullable=False, default="")
    reasons_json = Column(String, nullable=True)  # JSON 문자열(배열/객체)

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_a1_state_date_surface", "date", "surface"),
        Index("ix_a1_state_surface_state_date", "surface", "state", "date"),
    )


class A1SkuEventDaily(Base):
    """
    SKU 이벤트(경보) 일별 감지 결과.
    - DEFENSE_LINE_BREACH_4_6 / STATE_DOWNGRADE / CONSECUTIVE_DROP_3D 등
    """

    __tablename__ = "sku_event_daily"

    date = Column(Date, primary_key=True)
    surface = Column(String, primary_key=True)
    sku_id = Column(String, primary_key=True)
    event_type = Column(String, primary_key=True)

    severity = Column(String, nullable=False, default="LOW")  # LOW | MEDIUM | HIGH | CRITICAL
    payload_json = Column(String, nullable=True)  # JSON 문자열(근거/상세)

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_a1_event_date_surface_severity", "date", "surface", "severity"),
        Index("ix_a1_event_surface_sku_date", "surface", "sku_id", "date"),
    )


class A1SkuKeywordEvidenceDaily(Base):
    """
    키워드 단위 근거 수치(전일 스냅샷) - GPT 입력에 들어가는 팩트.
    """

    __tablename__ = "sku_keyword_evidence_daily"

    date = Column(Date, primary_key=True)
    surface = Column(String, primary_key=True)
    sku_id = Column(String, primary_key=True)
    keyword = Column(String, primary_key=True)

    rank_today = Column(Integer, nullable=True)
    rank_yesterday = Column(Integer, nullable=True)
    rank_7d_ago = Column(Integer, nullable=True)
    rank_delta_1d = Column(Integer, nullable=True)
    rank_delta_7d = Column(Integer, nullable=True)
    is_consecutive_drop_3d = Column(Boolean, nullable=False, default=False)

    monthly_search_volume = Column(Integer, nullable=True)
    is_cannibal = Column(Boolean, nullable=False, default=False)
    cannibal_evidence_json = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_a1_kw_date_surface_sku", "date", "surface", "sku_id"),
        Index("ix_a1_kw_surface_keyword_date", "surface", "keyword", "date"),
    )


class A1SkuCauseEvidenceDaily(Base):
    """
    SKU 단위 원인 분석용 근거 요약(전일 스냅샷) - 숫자 근거 중심.
    """

    __tablename__ = "sku_cause_evidence_daily"

    date = Column(Date, primary_key=True)
    surface = Column(String, primary_key=True)
    sku_id = Column(String, primary_key=True)

    decision_kw_total = Column(Integer, nullable=False, default=0)
    drop_kw_cnt_1d = Column(Integer, nullable=False, default=0)
    avg_drop_1d = Column(Float, nullable=True)
    consecutive_drop_3d_kw_cnt = Column(Integer, nullable=False, default=0)
    cannibal_kw_cnt = Column(Integer, nullable=False, default=0)
    cannibal_kw_drop_cnt = Column(Integer, nullable=False, default=0)

    evidence_json = Column(String, nullable=True)  # JSON 문자열(추가 근거/메타)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_a1_cause_date_surface", "date", "surface"),
        Index("ix_a1_cause_surface_sku_date", "surface", "sku_id", "date"),
    )


class A1GptActionDaily(Base):
    """
    (배치) GPT 호출 입력/출력 저장.
    - 동일 (date, surface, sku_id, action_version) 조합은 upsert(또는 overwrite) 대상.
    """

    __tablename__ = "gpt_action_daily"

    date = Column(Date, primary_key=True)
    surface = Column(String, primary_key=True)
    sku_id = Column(String, primary_key=True)
    action_version = Column(String, primary_key=True, default="A1_V1")

    payload_json = Column(String, nullable=False, default="")  # JSON 문자열
    result_json = Column(String, nullable=True)  # JSON 문자열
    model = Column(String, nullable=True)
    status = Column(String, nullable=False, default="PENDING")  # PENDING | SUCCESS | FAILED
    error = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_a1_gpt_date_surface_status", "date", "surface", "status"),
        Index("ix_a1_gpt_surface_sku_date", "surface", "sku_id", "date"),
    )


# -----------------------------
# A-1 Trace(감사/재현) 테이블
# - "최종 제안 → 근거/계산/규칙/이벤트/쿼리"를 역추적하기 위한 그래프(DAG) 저장
# - SQLite(테스트)에서도 동작하도록 JSONB 대신 TEXT(JSON 문자열)로 저장
# -----------------------------


class AnalysisBlob(Base):
    """
    대용량 스냅샷 저장(중복 제거).
    - 동일 content_hash는 1개만 저장하도록 UNIQUE로 dedupe 한다.
    """

    __tablename__ = "analysis_blob"

    blob_id = Column(String, primary_key=True)
    content_type = Column(String, nullable=False, default="json")  # json | text | table
    content_text = Column(String, nullable=False, default="")  # JSON 문자열 또는 텍스트
    content_hash = Column(String, nullable=False, unique=True)
    size = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (Index("ix_blob_hash", "content_hash"),)


class AnalysisRun(Base):
    """
    분석 실행 1회(런) 메타데이터.
    """

    __tablename__ = "analysis_run"

    run_id = Column(String, primary_key=True)
    analysis_type = Column(String, nullable=False, default="A-1")
    run_date = Column(Date, nullable=False)
    surface = Column(String, nullable=False, default="mobile_integrated")
    action_version = Column(String, nullable=False, default="A1_V1")
    model = Column(String, nullable=True)
    status = Column(String, nullable=False, default="SUCCESS")  # SUCCESS | FAILED | PARTIAL
    actor = Column(String, nullable=True)
    code_version = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_run_type_date", "analysis_type", "run_date"),
        Index("ix_run_date_surface", "run_date", "surface"),
    )


class AnalysisTraceNode(Base):
    """
    Trace 그래프의 노드.
    - blob_id는 스냅샷(원본/근거/결과)을 가리킨다.
    - query_sql/query_params_json/formula는 '재현/검증' 정보다.
    """

    __tablename__ = "analysis_trace_node"

    node_id = Column(String, primary_key=True)
    run_id = Column(String, nullable=False)
    sku_id = Column(String, nullable=False, default="")

    node_type = Column(String, nullable=False, default="UNKNOWN")
    title = Column(String, nullable=False, default="")
    summary_md = Column(String, nullable=False, default="")
    severity = Column(String, nullable=True)  # LOW|MEDIUM|HIGH|CRITICAL

    query_sql = Column(String, nullable=True)
    query_params_json = Column(String, nullable=True)
    formula = Column(String, nullable=True)

    blob_id = Column(String, nullable=True)
    content_hash = Column(String, nullable=True)
    content_type = Column(String, nullable=True)  # json | text | table

    sort_key = Column(Integer, nullable=False, default=0)
    tags_json = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_trace_node_run_sku", "run_id", "sku_id"),
        Index("ix_trace_node_run_sort", "run_id", "sort_key"),
        Index("ix_trace_node_type", "node_type"),
    )


class AnalysisTraceEdge(Base):
    """
    Trace 그래프의 엣지(DAG).
    """

    __tablename__ = "analysis_trace_edge"

    run_id = Column(String, primary_key=True)
    from_node_id = Column(String, primary_key=True)
    to_node_id = Column(String, primary_key=True)
    edge_type = Column(String, nullable=False, default="derives_from")
    label = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_trace_edge_run_from", "run_id", "from_node_id"),
        Index("ix_trace_edge_run_to", "run_id", "to_node_id"),
    )


class AnalysisActionReview(Base):
    """
    사용자의 '수락/미수락/의견' 기록(액션 단위).
    - Trace의 run_id + sku_id에 결합해, 제안/검증/결정 과정을 감사 가능하게 한다.
    - 동일 run_id/sku_id/action_title 조합은 1개로 유지(업서트).
    """

    __tablename__ = "analysis_action_review"

    review_id = Column(String, primary_key=True)
    run_id = Column(String, nullable=False)
    sku_id = Column(String, nullable=False, default="")

    action_title = Column(String, nullable=False, default="")
    accepted = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    comment = Column(String, nullable=True)
    evidence_refs_json = Column(String, nullable=True)  # JSON 문자열(list[str] 또는 dict)

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    __table_args__ = (
        Index("ix_action_review_run_sku", "run_id", "sku_id"),
        Index("ux_action_review_unique", "run_id", "sku_id", "action_title", unique=True),
    )


def init_db() -> None:
    """
    Analytics DB 의 기본 테이블을 생성한다.

    - FastAPI startup 이벤트나 별도 초기화 스크립트에서 호출할 수 있다.
    """
    Base.metadata.create_all(bind=engine)

    # SQLite(테스트)에서는 아래의 Postgres 전용 ALTER TABLE 문들이 실패할 수 있다.
    # - 테스트는 create_all로 충분하며, "방어적 스키마 진화"는 Postgres에만 적용한다.
    try:
        if str(getattr(engine, "dialect", None).name or "").lower() != "postgresql":
            return
    except Exception:
        return

    # 기존 테이블에 새 컬럼/타입이 없을 수도 있으므로 방어적으로 추가/변환
    with engine.connect() as conn:
        try:
            # High-volume fact tables are queried mainly by date ranges plus campaign,
            # keyword, product, or source filters. create_all() does not add indexes to
            # existing Postgres tables, so keep these operational indexes idempotent.
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ad_searchword_date_campaign_adgroup ON naver_ad_searchword_daily (date, campaign_name, adgroup_name)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ad_searchword_date_matched_keyword ON naver_ad_searchword_daily (date, matched_keyword)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ad_searchword_searchword_date ON naver_ad_searchword_daily (searchword, date)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ad_searchword_source_date ON naver_ad_searchword_daily (source, date)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ad_searchword_kind_date ON naver_ad_searchword_daily (campaign_kind, date)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ad_creative_date_campaign_adgroup ON naver_ad_creative_daily (date, campaign_name, adgroup_name)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ad_creative_creative_date ON naver_ad_creative_daily (creative_id, date)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ad_creative_keyword_date ON naver_ad_creative_daily (display_keyword, date)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ad_creative_source_date ON naver_ad_creative_daily (source, date)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_product_rank_keyword_date ON naver_product_rank_daily (keyword, date)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_product_rank_product_id_date ON naver_product_rank_daily (product_id, date)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_product_rank_product_url_date ON naver_product_rank_daily (product_url, date)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_product_rank_date_our_brand ON naver_product_rank_daily (date, is_our_brand)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tracked_rank_product_date ON tracked_product_rank_daily (product_url, date)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tracked_rank_keyword_date ON tracked_product_rank_daily (keyword, date)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tracked_rank_source_date ON tracked_product_rank_daily (source, date)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_collection_job_task_status_started ON collection_job_run (task_id, status, started_at)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_collection_job_event_job_created ON collection_job_event (job_id, created_at)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_collection_job_event_task_created ON collection_job_event (task_id, created_at)"))
            conn.commit()
        except Exception as e:  # pragma: no cover
            print("CREATE high-volume fact indexes failed:", e)

        try:
            conn.execute(text("ALTER TABLE ad_rank_diagnosis_daily ADD COLUMN IF NOT EXISTS ad_type VARCHAR"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ad_rank_diag_daily_ad_type ON ad_rank_diagnosis_daily (ad_type)"))
            conn.commit()
        except Exception as e:  # pragma: no cover
            print("ALTER TABLE ad_rank_diagnosis_daily failed:", e)

        try:
            conn.execute(text("ALTER TABLE naver_gfa_creative_generation_run ADD COLUMN IF NOT EXISTS batch_id VARCHAR"))
            conn.execute(text("ALTER TABLE naver_gfa_creative_generation_run ADD COLUMN IF NOT EXISTS candidate_index INTEGER NOT NULL DEFAULT 1"))
            conn.execute(text("ALTER TABLE naver_gfa_creative_generation_run ADD COLUMN IF NOT EXISTS candidate_count INTEGER NOT NULL DEFAULT 1"))
            conn.execute(text("ALTER TABLE naver_gfa_creative_generation_run ADD COLUMN IF NOT EXISTS combination_strategy_json VARCHAR"))
            conn.execute(text("ALTER TABLE naver_gfa_creative_generation_run ADD COLUMN IF NOT EXISTS generation_explanation_json VARCHAR"))
            conn.execute(text("ALTER TABLE naver_gfa_creative_generation_run ADD COLUMN IF NOT EXISTS usage_status VARCHAR NOT NULL DEFAULT 'not_used'"))
            conn.execute(text("ALTER TABLE naver_gfa_creative_generation_run ADD COLUMN IF NOT EXISTS used_campaign_name VARCHAR"))
            conn.execute(text("ALTER TABLE naver_gfa_creative_generation_run ADD COLUMN IF NOT EXISTS used_adgroup_name VARCHAR"))
            conn.execute(text("ALTER TABLE naver_gfa_creative_generation_run ADD COLUMN IF NOT EXISTS used_creative_name VARCHAR"))
            conn.execute(text("ALTER TABLE naver_gfa_creative_generation_run ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ"))
            conn.execute(text("ALTER TABLE naver_gfa_creative_generation_run ADD COLUMN IF NOT EXISTS feedback_summary VARCHAR"))
            conn.execute(text("ALTER TABLE naver_gfa_creative_generation_run ADD COLUMN IF NOT EXISTS generation_source VARCHAR NOT NULL DEFAULT 'existing'"))
            conn.execute(text("ALTER TABLE naver_gfa_creative_generation_run ADD COLUMN IF NOT EXISTS appeal_point_id VARCHAR"))
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_gfa_creative_generation_batch "
                    "ON naver_gfa_creative_generation_run (batch_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_gfa_creative_generation_usage "
                    "ON naver_gfa_creative_generation_run (usage_status)"
                )
            )
            conn.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS naver_gfa_creative_generation_event ("
                    "event_id VARCHAR PRIMARY KEY, "
                    "run_id VARCHAR NOT NULL, "
                    "batch_id VARCHAR, "
                    "event_type VARCHAR NOT NULL DEFAULT '', "
                    "actor VARCHAR, "
                    "note VARCHAR, "
                    "payload_json VARCHAR, "
                    "created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP"
                    ")"
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_gfa_creative_generation_event_run ON naver_gfa_creative_generation_event (run_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_gfa_creative_generation_event_batch ON naver_gfa_creative_generation_event (batch_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_gfa_creative_generation_event_type ON naver_gfa_creative_generation_event (event_type)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_gfa_creative_generation_event_created ON naver_gfa_creative_generation_event (created_at)"))
            conn.commit()
        except Exception as e:  # pragma: no cover
            print("ALTER TABLE naver_gfa_creative_generation_run failed:", e)

        try:
            conn.execute(text("ALTER TABLE naver_gfa_strategy_snapshot ALTER COLUMN payload_json DROP NOT NULL"))
            conn.commit()
        except Exception as e:  # pragma: no cover
            print("ALTER TABLE naver_gfa_strategy_snapshot payload nullable failed:", e)

        try:
            conn.execute(text("ALTER TABLE content_artifact ADD COLUMN IF NOT EXISTS parent_artifact_id VARCHAR"))
            conn.execute(text("ALTER TABLE content_artifact ADD COLUMN IF NOT EXISTS original_artifact_id VARCHAR"))
            conn.execute(text("ALTER TABLE content_artifact ADD COLUMN IF NOT EXISTS revision_no INTEGER NOT NULL DEFAULT 1"))
            conn.execute(text("ALTER TABLE content_artifact ADD COLUMN IF NOT EXISTS revision_reason VARCHAR"))
            conn.execute(text("ALTER TABLE content_artifact ADD COLUMN IF NOT EXISTS source VARCHAR NOT NULL DEFAULT 'ai_original'"))
            conn.execute(text("ALTER TABLE content_artifact ADD COLUMN IF NOT EXISTS is_published_version BOOLEAN NOT NULL DEFAULT false"))
            conn.execute(text("UPDATE content_artifact SET original_artifact_id = artifact_id WHERE original_artifact_id IS NULL"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_content_artifact_original ON content_artifact (original_artifact_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_content_artifact_parent ON content_artifact (parent_artifact_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_content_artifact_published ON content_artifact (is_published_version)"))
            conn.commit()
        except Exception as e:  # pragma: no cover
            print("ALTER TABLE content_artifact revision fields failed:", e)

        try:
            conn.execute(text("ALTER TABLE content_appeal_point ADD COLUMN IF NOT EXISTS admin_review_status VARCHAR"))
            conn.execute(text("ALTER TABLE content_appeal_point ADD COLUMN IF NOT EXISTS admin_review_note VARCHAR"))
            conn.execute(text("ALTER TABLE content_appeal_point ADD COLUMN IF NOT EXISTS admin_reviewed_at TIMESTAMPTZ"))
            conn.commit()
        except Exception as e:  # pragma: no cover
            print("ALTER TABLE content_appeal_point admin review fields failed:", e)

        try:
            conn.execute(text("ALTER TABLE content_appeal_evidence ADD COLUMN IF NOT EXISTS is_excluded BOOLEAN NOT NULL DEFAULT false"))
            conn.execute(text("ALTER TABLE content_appeal_evidence ADD COLUMN IF NOT EXISTS excluded_reason VARCHAR"))
            conn.execute(text("ALTER TABLE content_appeal_evidence ADD COLUMN IF NOT EXISTS excluded_at TIMESTAMPTZ"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_content_appeal_evidence_excluded ON content_appeal_evidence (is_excluded)"))
            conn.commit()
        except Exception as e:  # pragma: no cover
            print("ALTER TABLE content_appeal_evidence exclude fields failed:", e)

        try:
            conn.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS content_sku_asset ("
                    "asset_id VARCHAR PRIMARY KEY, "
                    "sku_id VARCHAR NOT NULL, "
                    "product_url VARCHAR, "
                    "asset_type VARCHAR NOT NULL DEFAULT 'product_image', "
                    "asset_group_id VARCHAR, "
                    "group_name VARCHAR, "
                    "category VARCHAR, "
                    "keywords VARCHAR, "
                    "sku_ids VARCHAR, "
                    "filename VARCHAR NOT NULL, "
                    "original_filename VARCHAR, "
                    "mime_type VARCHAR, "
                    "file_path VARCHAR NOT NULL, "
                    "file_url VARCHAR NOT NULL, "
                    "sort_order INTEGER NOT NULL DEFAULT 0, "
                    "is_primary BOOLEAN NOT NULL DEFAULT false, "
                    "analysis_status VARCHAR NOT NULL DEFAULT 'PENDING', "
                    "analysis_json VARCHAR, "
                    "error_message VARCHAR, "
                    "created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "
                    "updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP"
                    ")"
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_content_sku_asset_sku_type ON content_sku_asset (sku_id, asset_type)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_content_sku_asset_url_type ON content_sku_asset (product_url, asset_type)"))
            conn.execute(text("ALTER TABLE content_sku_asset ADD COLUMN IF NOT EXISTS asset_group_id VARCHAR"))
            conn.execute(text("ALTER TABLE content_sku_asset ADD COLUMN IF NOT EXISTS group_name VARCHAR"))
            conn.execute(text("ALTER TABLE content_sku_asset ADD COLUMN IF NOT EXISTS category VARCHAR"))
            conn.execute(text("ALTER TABLE content_sku_asset ADD COLUMN IF NOT EXISTS keywords VARCHAR"))
            conn.execute(text("ALTER TABLE content_sku_asset ADD COLUMN IF NOT EXISTS sku_ids VARCHAR"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_content_sku_asset_group_type ON content_sku_asset (asset_group_id, asset_type)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_content_sku_asset_category_type ON content_sku_asset (category, asset_type)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_content_sku_asset_primary ON content_sku_asset (sku_id, asset_type, is_primary)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_content_sku_asset_created ON content_sku_asset (created_at)"))
            conn.commit()
        except Exception as e:  # pragma: no cover
            print("CREATE TABLE content_sku_asset failed:", e)

        try:
            conn.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS content_product_info ("
                    "sku_id VARCHAR PRIMARY KEY, "
                    "product_url VARCHAR, "
                    "full_ingredients VARCHAR, "
                    "product_items_json VARCHAR, "
                    "ingredient_note VARCHAR, "
                    "source_note VARCHAR, "
                    "created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "
                    "updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP"
                    ")"
                )
            )
            conn.execute(text("ALTER TABLE content_product_info ADD COLUMN IF NOT EXISTS product_url VARCHAR"))
            conn.execute(text("ALTER TABLE content_product_info ADD COLUMN IF NOT EXISTS full_ingredients VARCHAR"))
            conn.execute(text("ALTER TABLE content_product_info ADD COLUMN IF NOT EXISTS product_items_json VARCHAR"))
            conn.execute(text("ALTER TABLE content_product_info ADD COLUMN IF NOT EXISTS ingredient_note VARCHAR"))
            conn.execute(text("ALTER TABLE content_product_info ADD COLUMN IF NOT EXISTS source_note VARCHAR"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_content_product_info_url ON content_product_info (product_url)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_content_product_info_updated ON content_product_info (updated_at)"))
            conn.commit()
        except Exception as e:  # pragma: no cover
            print("CREATE TABLE content_product_info failed:", e)

        try:
            conn.execute(text("ALTER TABLE review_reply_draft ADD COLUMN IF NOT EXISTS style_level INTEGER NOT NULL DEFAULT 3"))
            conn.execute(text("ALTER TABLE review_reply_draft ADD COLUMN IF NOT EXISTS style_preset_id VARCHAR"))
            conn.execute(text("ALTER TABLE review_reply_draft ADD COLUMN IF NOT EXISTS style_controls_json VARCHAR"))
            conn.execute(text("ALTER TABLE review_reply_draft ADD COLUMN IF NOT EXISTS rejection_comment VARCHAR"))
            conn.execute(text("ALTER TABLE review_reply_draft ADD COLUMN IF NOT EXISTS rejection_analyzed_at TIMESTAMPTZ"))
            conn.execute(text("ALTER TABLE review_reply_draft ADD COLUMN IF NOT EXISTS rejection_analysis_json VARCHAR"))
            conn.execute(text("ALTER TABLE review_reply_draft ADD COLUMN IF NOT EXISTS original_ai_text VARCHAR"))
            conn.execute(text("ALTER TABLE review_reply_draft ADD COLUMN IF NOT EXISTS lineage_origin VARCHAR"))
            conn.execute(text("ALTER TABLE review_reply_draft ADD COLUMN IF NOT EXISTS human_edit_count INTEGER NOT NULL DEFAULT 0"))
            conn.execute(text("ALTER TABLE review_reply_draft ADD COLUMN IF NOT EXISTS human_edited_at TIMESTAMPTZ"))
            conn.execute(text("ALTER TABLE review_reply_draft ADD COLUMN IF NOT EXISTS approved_text VARCHAR"))
            conn.execute(text("ALTER TABLE review_reply_draft ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ"))
            conn.execute(text("ALTER TABLE review_reply_draft ADD COLUMN IF NOT EXISTS published_text VARCHAR"))
            conn.execute(text("ALTER TABLE review_reply_draft ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ"))
            conn.commit()
        except Exception as e:  # pragma: no cover
            print("ALTER TABLE review_reply_draft failed:", e)

        try:
            for column in ("reviewer_uid", "reviewer_email", "reviewer_role", "knowhow_snapshot_json", "corpus_version"):
                conn.execute(text(f"ALTER TABLE review_reply_knowledge_validation ADD COLUMN IF NOT EXISTS {column} VARCHAR"))
            conn.commit()
        except Exception as e:  # pragma: no cover
            print("ALTER TABLE review_reply_knowledge_validation failed:", e)

        try:
            conn.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS review_reply_feedback_knowledge ("
                    "knowledge_id VARCHAR PRIMARY KEY, "
                    "source_draft_id VARCHAR NOT NULL, "
                    "status VARCHAR NOT NULL DEFAULT 'active', "
                    "problem_type VARCHAR, "
                    "problem_summary VARCHAR, "
                    "bad_pattern VARCHAR, "
                    "prevention_rule VARCHAR, "
                    "example_fix VARCHAR, "
                    "created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "
                    "updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP"
                    ")"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_review_reply_feedback_knowledge_source_draft_id "
                    "ON review_reply_feedback_knowledge (source_draft_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_review_reply_feedback_knowledge_status "
                    "ON review_reply_feedback_knowledge (status)"
                )
            )
            conn.commit()
        except Exception as e:  # pragma: no cover
            print("CREATE TABLE review_reply_feedback_knowledge failed:", e)

        try:
            conn.execute(text("ALTER TABLE naver_review_raw ADD COLUMN IF NOT EXISTS product_title VARCHAR"))
            conn.execute(
                text(
                    "ALTER TABLE naver_review_raw "
                    "ADD COLUMN IF NOT EXISTS import_source VARCHAR NOT NULL DEFAULT 'smartstore_product_page'"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_review_raw "
                    "ADD COLUMN IF NOT EXISTS reply_exists_flag BOOLEAN NOT NULL DEFAULT false"
                )
            )
            conn.execute(text("ALTER TABLE naver_review_raw ADD COLUMN IF NOT EXISTS reply_collect_status VARCHAR"))
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_naver_review_raw_reply_collect_status "
                    "ON naver_review_raw (reply_collect_status)"
                )
            )
            conn.commit()
        except Exception as e:  # pragma: no cover
            print("ALTER TABLE naver_review_raw failed:", e)

        try:
            # KeywordDaily / SearchwordDaily: 캠페인유형(정확 분리) 컬럼 추가
            conn.execute(
                text(
                    "ALTER TABLE naver_ad_keyword_daily "
                    "ADD COLUMN IF NOT EXISTS campaign_kind VARCHAR"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_ad_keyword_daily "
                    "ADD COLUMN IF NOT EXISTS conversion_semantics VARCHAR NOT NULL DEFAULT 'total_plus_purchase'"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_ad_keyword_daily "
                    "ADD COLUMN IF NOT EXISTS purchase_conversions INTEGER NOT NULL DEFAULT 0"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_ad_keyword_daily "
                    "ADD COLUMN IF NOT EXISTS purchase_revenue INTEGER NOT NULL DEFAULT 0"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_ad_searchword_daily "
                    "ADD COLUMN IF NOT EXISTS campaign_kind VARCHAR"
                )
            )

            # SearchwordDaily: UI 업로드에서 keyword 매핑을 보존하기 위한 컬럼 추가
            conn.execute(
                text(
                    "ALTER TABLE naver_ad_searchword_daily "
                    "ADD COLUMN IF NOT EXISTS matched_keyword VARCHAR"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_ad_searchword_daily "
                    "ADD COLUMN IF NOT EXISTS conversion_semantics VARCHAR NOT NULL DEFAULT 'total_plus_purchase'"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_ad_searchword_daily "
                    "ADD COLUMN IF NOT EXISTS purchase_conversions INTEGER NOT NULL DEFAULT 0"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_ad_searchword_daily "
                    "ADD COLUMN IF NOT EXISTS purchase_revenue INTEGER NOT NULL DEFAULT 0"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_ad_searchword_daily "
                    "ALTER COLUMN source SET DEFAULT 'unknown'"
                )
            )
            conn.execute(
                text(
                    "UPDATE naver_ad_searchword_daily "
                    "SET source = 'unknown' "
                    "WHERE source IS NULL OR btrim(source) = ''"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_ad_searchword_daily "
                    "ALTER COLUMN source SET NOT NULL"
                )
            )
            conn.execute(
                text(
                    """
                    DO $$
                    DECLARE
                        pk_cols text;
                    BEGIN
                        SELECT string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position)
                          INTO pk_cols
                          FROM information_schema.table_constraints tc
                          JOIN information_schema.key_column_usage kcu
                            ON kcu.constraint_name = tc.constraint_name
                           AND kcu.table_schema = tc.table_schema
                           AND kcu.table_name = tc.table_name
                         WHERE tc.table_schema = 'public'
                           AND tc.table_name = 'naver_ad_searchword_daily'
                           AND tc.constraint_type = 'PRIMARY KEY';

                        IF COALESCE(pk_cols, '') <> 'date,campaign_name,adgroup_name,searchword,device,source' THEN
                            ALTER TABLE naver_ad_searchword_daily DROP CONSTRAINT IF EXISTS naver_ad_searchword_daily_pkey;
                            ALTER TABLE naver_ad_searchword_daily
                                ADD CONSTRAINT naver_ad_searchword_daily_pkey
                                PRIMARY KEY (date, campaign_name, adgroup_name, searchword, device, source);
                        END IF;
                    END
                    $$;
                    """
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_ad_creative_daily "
                    "ADD COLUMN IF NOT EXISTS display_keyword VARCHAR NOT NULL DEFAULT ''"
                )
            )
            conn.execute(
                text(
                    "UPDATE naver_ad_creative_daily "
                    "SET display_keyword = '' "
                    "WHERE display_keyword IS NULL"
                )
            )
            conn.execute(
                text(
                    """
                    DO $$
                    DECLARE
                        pk_cols text;
                    BEGIN
                        SELECT string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position)
                          INTO pk_cols
                          FROM information_schema.table_constraints tc
                          JOIN information_schema.key_column_usage kcu
                            ON kcu.constraint_name = tc.constraint_name
                           AND kcu.table_schema = tc.table_schema
                           AND kcu.table_name = tc.table_name
                         WHERE tc.table_schema = 'public'
                           AND tc.table_name = 'naver_ad_creative_daily'
                           AND tc.constraint_type = 'PRIMARY KEY';

                        IF COALESCE(pk_cols, '') <> 'date,campaign_name,adgroup_name,creative_id,display_keyword,device' THEN
                            ALTER TABLE naver_ad_creative_daily DROP CONSTRAINT IF EXISTS naver_ad_creative_daily_pkey;
                            ALTER TABLE naver_ad_creative_daily
                                ADD CONSTRAINT naver_ad_creative_daily_pkey
                                PRIMARY KEY (date, campaign_name, adgroup_name, creative_id, display_keyword, device);
                        END IF;
                    END
                    $$;
                    """
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_ad_creative_daily "
                    "ADD COLUMN IF NOT EXISTS conversion_semantics VARCHAR NOT NULL DEFAULT 'total_plus_purchase'"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_ad_creative_daily "
                    "ADD COLUMN IF NOT EXISTS purchase_conversions INTEGER NOT NULL DEFAULT 0"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_ad_creative_daily "
                    "ADD COLUMN IF NOT EXISTS purchase_revenue INTEGER NOT NULL DEFAULT 0"
                )
            )

            conn.execute(
                text(
                    "ALTER TABLE naver_gfa_performance_daily "
                    "ADD COLUMN IF NOT EXISTS raw_payload_json VARCHAR"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_gfa_performance_daily "
                    "ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ"
                )
            )
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS naver_gfa_creative_detail (
                        ad_account_no VARCHAR NOT NULL DEFAULT '',
                        campaign_id VARCHAR NOT NULL DEFAULT '',
                        adgroup_id VARCHAR NOT NULL DEFAULT '',
                        creative_id VARCHAR NOT NULL DEFAULT '',
                        detail_url VARCHAR NOT NULL DEFAULT '',
                        creative_name VARCHAR NOT NULL DEFAULT '',
                        creative_type VARCHAR,
                        profile_name VARCHAR,
                        profile_image_url VARCHAR,
                        image_url VARCHAR,
                        image_path VARCHAR,
                        primary_text VARCHAR,
                        headline VARCHAR,
                        description VARCHAR,
                        cta VARCHAR,
                        landing_url VARCHAR,
                        raw_payload_json VARCHAR,
                        content_hash VARCHAR,
                        last_error VARCHAR,
                        collected_at TIMESTAMPTZ,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY (ad_account_no, campaign_id, adgroup_id, creative_id)
                    )
                    """
                )
            )
            conn.execute(text("ALTER TABLE naver_gfa_creative_detail ADD COLUMN IF NOT EXISTS profile_image_url VARCHAR"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_gfa_creative_detail_creative ON naver_gfa_creative_detail (creative_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_gfa_creative_detail_hash ON naver_gfa_creative_detail (content_hash)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_gfa_creative_detail_collected ON naver_gfa_creative_detail (collected_at)"))
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS naver_gfa_creative_image_analysis (
                        creative_id VARCHAR PRIMARY KEY,
                        image_url VARCHAR,
                        visual_subjects VARCHAR,
                        hair_condition_tags VARCHAR,
                        scene_tags VARCHAR,
                        emotion_tags VARCHAR,
                        composition_tags VARCHAR,
                        color_mood_tags VARCHAR,
                        product_visibility VARCHAR,
                        analysis_json VARCHAR,
                        confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
                        model_name VARCHAR,
                        status VARCHAR NOT NULL DEFAULT 'generated',
                        reviewed_at TIMESTAMPTZ,
                        analyzed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS naver_gfa_creative_copy_analysis (
                        creative_id VARCHAR PRIMARY KEY,
                        primary_text VARCHAR,
                        headline VARCHAR,
                        description VARCHAR,
                        cta VARCHAR,
                        core_keywords VARCHAR,
                        pain_points VARCHAR,
                        appeal_types VARCHAR,
                        message_tone VARCHAR,
                        cta_type VARCHAR,
                        analysis_json VARCHAR,
                        confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
                        model_name VARCHAR,
                        status VARCHAR NOT NULL DEFAULT 'generated',
                        reviewed_at TIMESTAMPTZ,
                        analyzed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_gfa_creative_image_analysis_status ON naver_gfa_creative_image_analysis (status)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_gfa_creative_image_analysis_analyzed ON naver_gfa_creative_image_analysis (analyzed_at)"))
            conn.execute(text("ALTER TABLE naver_gfa_creative_image_analysis ADD COLUMN IF NOT EXISTS color_mood_tags VARCHAR"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_gfa_creative_copy_analysis_status ON naver_gfa_creative_copy_analysis (status)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_gfa_creative_copy_analysis_analyzed ON naver_gfa_creative_copy_analysis (analyzed_at)"))
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS naver_gfa_analysis_result (
                        analysis_id VARCHAR PRIMARY KEY,
                        latest_key VARCHAR NOT NULL,
                        analysis_type VARCHAR NOT NULL,
                        date_from DATE,
                        date_to DATE,
                        params_json VARCHAR NOT NULL DEFAULT '{}',
                        params_hash VARCHAR NOT NULL,
                        analysis_version VARCHAR NOT NULL,
                        source_fingerprint VARCHAR NOT NULL,
                        result_json VARCHAR NOT NULL,
                        row_count INTEGER NOT NULL DEFAULT 0,
                        is_latest BOOLEAN NOT NULL DEFAULT TRUE,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_gfa_analysis_result_latest ON naver_gfa_analysis_result (latest_key, is_latest)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_gfa_analysis_result_type_dates ON naver_gfa_analysis_result (analysis_type, date_from, date_to)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_gfa_analysis_result_fingerprint ON naver_gfa_analysis_result (source_fingerprint)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_gfa_analysis_result_updated ON naver_gfa_analysis_result (updated_at)"))

            # product_id / image_url 컬럼이 없으면 추가
            conn.execute(
                text(
                    "ALTER TABLE naver_product_rank_daily "
                    "ADD COLUMN IF NOT EXISTS product_id BIGINT"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_product_rank_daily "
                    "ADD COLUMN IF NOT EXISTS product_url VARCHAR"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_product_rank_daily "
                    "ADD COLUMN IF NOT EXISTS image_url VARCHAR"
                )
            )
            # 추가 메타 컬럼들 (이미 존재하면 에러 없이 무시되도록 IF NOT EXISTS 사용)
            conn.execute(
                text(
                    "ALTER TABLE naver_product_rank_daily "
                    "ADD COLUMN IF NOT EXISTS category1 VARCHAR"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_product_rank_daily "
                    "ADD COLUMN IF NOT EXISTS category2 VARCHAR"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_product_rank_daily "
                    "ADD COLUMN IF NOT EXISTS category3 VARCHAR"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_product_rank_daily "
                    "ADD COLUMN IF NOT EXISTS category4 VARCHAR"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_product_rank_daily "
                    "ADD COLUMN IF NOT EXISTS brand VARCHAR"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE naver_product_rank_daily "
                    "ADD COLUMN IF NOT EXISTS maker VARCHAR"
                )
            )
            # CDP rank evidence fields. Keep the original card condition so
            # ranks can be re-derived without recollecting.
            for column_sql in (
                "card_type VARCHAR",
                "source_type VARCHAR",
                "sas_type VARCHAR",
                "channel_product_id VARCHAR",
                "original_mall_product_id VARCHAR",
                "nv_mid BIGINT",
                "rank_source VARCHAR",
                "card_json TEXT",
            ):
                conn.execute(
                    text(
                        "ALTER TABLE naver_product_rank_daily "
                        f"ADD COLUMN IF NOT EXISTS {column_sql}"
                    )
                )

            # 기존 INTEGER product_id 컬럼이 있을 수 있으므로 BIGINT 로 승격
            try:
                conn.execute(
                    text(
                        "ALTER TABLE naver_product_rank_daily "
                        "ALTER COLUMN product_id TYPE BIGINT USING product_id::BIGINT"
                    )
                )
            except Exception:
                # 타입 변환 실패는 로그만 남기고 계속 진행
                print(
                    "ALTER COLUMN naver_product_rank_daily.product_id "
                    "to BIGINT skipped (already BIGINT or incompatible)"
                )

            conn.commit()
        except Exception as e:  # pragma: no cover - 방어적 처리
            print("ALTER TABLE naver_product_rank_daily failed:", e)

        # tracked_product_keyword에 월간 검색량 컬럼이 없을 수 있어 방어적으로 추가
        try:
            conn.execute(
                text(
                    "ALTER TABLE tracked_product_keyword "
                    "ADD COLUMN IF NOT EXISTS monthly_search_volume INTEGER"
                )
            )
            conn.commit()
        except Exception as e:  # pragma: no cover
            print("ALTER TABLE tracked_product_keyword failed:", e)

        # tracked_product_meta에 카테고리 컬럼이 없을 수 있어 방어적으로 추가
        try:
            conn.execute(text("ALTER TABLE tracked_product_meta ADD COLUMN IF NOT EXISTS category1 VARCHAR"))
            conn.execute(text("ALTER TABLE tracked_product_meta ADD COLUMN IF NOT EXISTS category2 VARCHAR"))
            conn.execute(text("ALTER TABLE tracked_product_meta ADD COLUMN IF NOT EXISTS category3 VARCHAR"))
            conn.execute(text("ALTER TABLE tracked_product_meta ADD COLUMN IF NOT EXISTS category4 VARCHAR"))
            conn.execute(text("ALTER TABLE tracked_product_meta ADD COLUMN IF NOT EXISTS tracking_mode VARCHAR"))
            conn.commit()
        except Exception as e:  # pragma: no cover
            print("ALTER TABLE tracked_product_meta failed:", e)

        # ad_rank_diagnosis_preset: 조건별 광고 기준 순위 컬럼 추가
        try:
            conn.execute(
                text(
                    "ALTER TABLE ad_rank_diagnosis_preset "
                    "ADD COLUMN IF NOT EXISTS target_rank INTEGER NOT NULL DEFAULT 20"
                )
            )
            conn.commit()
        except Exception as e:  # pragma: no cover
            print("ALTER TABLE ad_rank_diagnosis_preset failed:", e)

        # tracked_product_page_daily: 구매/재구매 배지(best-effort) 컬럼 추가
        try:
            conn.execute(text("ALTER TABLE tracked_product_page_daily ADD COLUMN IF NOT EXISTS recent_purchase_count INTEGER"))
            conn.execute(text("ALTER TABLE tracked_product_page_daily ADD COLUMN IF NOT EXISTS recent_purchase_window VARCHAR"))
            conn.execute(text("ALTER TABLE tracked_product_page_daily ADD COLUMN IF NOT EXISTS recent_purchase_status VARCHAR"))
            conn.execute(text("ALTER TABLE tracked_product_page_daily ADD COLUMN IF NOT EXISTS recent_purchase_7d_count INTEGER"))
            conn.execute(text("ALTER TABLE tracked_product_page_daily ADD COLUMN IF NOT EXISTS recent_repurchase_count INTEGER"))
            conn.execute(text("ALTER TABLE tracked_product_page_daily ADD COLUMN IF NOT EXISTS recent_repurchase_window VARCHAR"))
            conn.execute(text("ALTER TABLE tracked_product_page_daily ADD COLUMN IF NOT EXISTS recent_repurchase_3m_count INTEGER"))
            conn.execute(text("ALTER TABLE tracked_product_page_daily ADD COLUMN IF NOT EXISTS recent_badge_text VARCHAR"))
            conn.execute(text("ALTER TABLE tracked_product_page_daily ADD COLUMN IF NOT EXISTS wish_count INTEGER"))
            conn.execute(text("ALTER TABLE tracked_product_page_daily ADD COLUMN IF NOT EXISTS registered_date DATE"))
            conn.commit()
        except Exception as e:  # pragma: no cover
            print("ALTER TABLE tracked_product_page_daily failed:", e)

        # naver_product_review_daily: 과거 스키마가 INTEGER product_id 를 쓸 수 있어
        # 최근 catalog productId(10~11자리) 백필 시 overflow가 난다.
        # 운영 DB startup 때 BIGINT로 자동 승격해, 백필/실시간 적재가 모두 같은 스키마를 보도록 맞춘다.
        try:
            conn.execute(
                text(
                    "ALTER TABLE naver_product_review_daily "
                    "ALTER COLUMN product_id TYPE BIGINT USING product_id::BIGINT"
                )
            )
            conn.commit()
        except Exception:
            print(
                "ALTER COLUMN naver_product_review_daily.product_id "
                "to BIGINT skipped (already BIGINT or incompatible)"
            )


# 테스트 환경에서는 FastAPI startup을 거치지 않는 단위 테스트도 있어,
# 모듈 import 시점에 기본 테이블을 보장한다.
try:  # pragma: no cover
    if _is_testing() or _is_pytest_argv() or _is_unittest_argv():
        init_db()
except Exception:
    # 실패해도 테스트가 바로 죽지 않게 방어(개별 테스트가 자체 engine으로 테이블 생성하는 케이스가 있음)
    pass


def _parse_date(date_str: str) -> date:
    return datetime.strptime(date_str, "%Y-%m-%d").date()


def replace_purchase_keyword_daily_from_df(
    df: Any, target_date: str, *, source: str = "purchase_upload"
) -> int:
    """
    구매 키워드 업로드 DF를 `naver_smartstore_purchase_keyword_daily`에 저장한다.

    - 같은 날짜/같은 source는 "완전 교체"로 동작하도록 먼저 삭제한 뒤 업서트한다.
    - 기대 컬럼(대표):
      - (선택) 일자
      - 상품카테고리(대/중/소/세)
      - 상품명, 상품ID
      - 채널그룹, 채널명, 키워드
      - 결제수, 결제금액
    """
    d = _parse_date(target_date)

    def _clear_existing() -> None:
        with SessionLocal() as session:
            session.query(NaverSmartstorePurchaseKeywordDaily).filter(
                NaverSmartstorePurchaseKeywordDaily.date == d,
                NaverSmartstorePurchaseKeywordDaily.source == source,
            ).delete(synchronize_session=False)
            session.commit()

    if df is None or df.empty:
        _clear_existing()
        return 0

    def _first_number(v: object) -> float | None:
        """
        "1 (0.0%)", "90,879 (64.7%)", "0 (0.0%)" 처럼 한 셀에
        본값 + (비율) 이 같이 들어오는 케이스가 있어도,
        '첫 번째 숫자(본값)'만 안정적으로 추출한다.

        기존 방식처럼 숫자/점(.)만 남기면 "1.00.0" 같은 문자열이 되어 0으로 떨어질 수 있다.
        """
        try:
            if v is None:
                return None
            if isinstance(v, bool):
                return float(int(v))
            if isinstance(v, (int, float)):
                return float(v)
            s = str(v).strip()
            if not s:
                return None
            # 천단위 콤마 제거(숫자 토큰 추출 전에 정규화)
            s = s.replace(",", "")
            m = re.search(r"[-+]?\d+(?:\.\d+)?", s)
            if not m:
                return None
            n = float(m.group(0))
            return n if math.isfinite(n) else None
        except Exception:
            return None

    def _to_decimal(v: object) -> float:
        n = _first_number(v)
        if n is None:
            return 0.0
        try:
            return float(n)
        except Exception:
            return 0.0

    def _to_int(v: object) -> int:
        """
        product_id 등 정수 PK 파싱.
        - CSV/XLSX에서 float로 읽히는 케이스(예: 5897739461.0)도 안정적으로 처리한다.
        """
        try:
            if v is None:
                return 0
            if isinstance(v, bool):
                return int(v)
            if isinstance(v, (int, float)):
                return int(v)
            s = str(v).strip()
            if not s:
                return 0
            s = s.replace(",", "")
            m = re.search(r"[-+]?\d+(?:\.\d+)?", s)
            if not m:
                return 0
            return int(float(m.group(0)))
        except Exception:
            return 0

    records: list[dict] = []
    for _, r in df.iterrows():
        try:
            pid_raw = r.get("상품ID") or r.get("상품 ID") or r.get("product_id")
            pid = _to_int(pid_raw)
            # 업로드 정규화 단계에서 "키워드"로 표준화되지만,
            # 방어적으로 "검색어" 케이스도 허용한다.
            kw = str(r.get("키워드") or r.get("검색어") or r.get("keyword") or "").strip()
            if pid <= 0 or not kw:
                continue

            cg = str(r.get("채널그룹") or r.get("channel_group") or "").strip()
            cn = str(r.get("채널명") or r.get("channel_name") or "").strip()

            c1 = str(r.get("상품카테고리(대)") or r.get("category1") or "").strip() or None
            c2 = str(r.get("상품카테고리(중)") or r.get("category2") or "").strip() or None
            c3 = str(r.get("상품카테고리(소)") or r.get("category3") or "").strip() or None
            c4 = str(r.get("상품카테고리(세)") or r.get("category4") or "").strip() or None
            pname = str(r.get("상품명") or r.get("product_name") or "").strip() or None

            payments = _to_decimal(
                r.get("결제수") or r.get("payments") or r.get("결제수(기여도추정)") or r.get("결제수 (기여도추정)")
            )
            amount = _to_decimal(
                r.get("결제금액") or r.get("amount") or r.get("결제금액(기여도추정)") or r.get("결제금액 (기여도추정)")
            )

            records.append(
                {
                    "date": d,
                    "product_id": int(pid),
                    "channel_group": cg,
                    "channel_name": cn,
                    "keyword": kw,
                    "category1": c1,
                    "category2": c2,
                    "category3": c3,
                    "category4": c4,
                    "product_name": pname,
                    "payments": float(payments or 0.0),
                    "amount": float(amount or 0.0),
                    "source": source,
                }
            )
        except Exception:
            continue

    if not records:
        _clear_existing()
        return 0

    with SessionLocal() as session:
        session.query(NaverSmartstorePurchaseKeywordDaily).filter(
            NaverSmartstorePurchaseKeywordDaily.date == d,
            NaverSmartstorePurchaseKeywordDaily.source == source,
        ).delete(synchronize_session=False)

        stmt = insert(NaverSmartstorePurchaseKeywordDaily).values(records)
        update_cols: Iterable[str] = (
            c.name
            for c in NaverSmartstorePurchaseKeywordDaily.__table__.columns
            if c.name
            not in (
                "date",
                "product_id",
                "channel_group",
                "channel_name",
                "keyword",
                "created_at",
            )
        )
        upsert_stmt = stmt.on_conflict_do_update(
            index_elements=[
                NaverSmartstorePurchaseKeywordDaily.date,
                NaverSmartstorePurchaseKeywordDaily.product_id,
                NaverSmartstorePurchaseKeywordDaily.channel_group,
                NaverSmartstorePurchaseKeywordDaily.channel_name,
                NaverSmartstorePurchaseKeywordDaily.keyword,
            ],
            set_={col: getattr(stmt.excluded, col) for col in update_cols},
        )
        session.execute(upsert_stmt)
        session.commit()

    return len(records)


def upsert_keyword_daily_from_df(
    df: Any, target_date: str, *, source: str = "keyword_csv"
) -> int:
    """
    `normalize_keyword_report_rows_from_df` 이후 생성된 DataFrame(df_all)을
    `naver_ad_keyword_daily` 테이블에 upsert 한다.

    기대 컬럼:
      - 캠페인, 광고 그룹, 키워드
      - 노출수, 클릭수, 총비용(원), 전환수, 전환매출액(원)
      - 클릭률(%), 전환율(%), ROAS(%), CPC(원)
    """
    if df is None or df.empty:
        return 0

    d = _parse_date(target_date)

    records: list[dict] = []
    for _, r in df.iterrows():
        campaign = str(r.get("캠페인") or "").strip()
        adgroup = str(r.get("광고 그룹") or "").strip()
        keyword = str(r.get("키워드") or "").strip()
        if not keyword:
            continue

        # 보고서/정규화 단계에서 캠페인유형이 제공되면 그대로 보존한다.
        # 값이 없으면 None(기존 prefix 기반 best-effort 필터가 폴백으로 동작)
        ck_raw = (
            r.get("캠페인유형")
            or r.get("캠페인 유형")
            or r.get("campaign_kind")
            or r.get("campaignKind")
            or ""
        )
        campaign_kind = _normalize_campaign_kind_value(ck_raw)

        impressions = int(r.get("노출수") or 0)
        clicks = int(r.get("클릭수") or 0)
        cost = int(r.get("총비용(원)") or 0)
        metrics = normalize_conversion_metrics(
            target_date=d,
            conversions=int(r.get("전환수") or 0),
            revenue=int(r.get("전환매출액(원)") or 0),
            purchase_conversions=int(r.get("구매전환수") or r.get("purchase_conversions") or 0),
            purchase_revenue=int(r.get("구매전환매출액(원)") or r.get("purchase_revenue") or 0),
        )

        ctr = float(r.get("클릭률(%)") or 0.0)
        cpc = float(r.get("CPC(원)") or 0.0)
        cvr = float(r.get("전환율(%)") or 0.0)
        roas = float(r.get("ROAS(%)") or 0.0)
        if str(metrics.get("conversion_semantics") or "") == "legacy_purchase_only":
            roas = 0.0

        records.append(
            {
                "date": d,
                "campaign_name": campaign,
                "adgroup_name": adgroup,
                "keyword": keyword,
                "device": "ALL",
                "campaign_kind": campaign_kind,
                "impressions": impressions,
                "clicks": clicks,
                "cost": cost,
                "conversions": int(metrics.get("conversions") or 0),
                "revenue": int(metrics.get("revenue") or 0),
                "conversion_semantics": str(metrics.get("conversion_semantics") or "total_plus_purchase"),
                "purchase_conversions": int(metrics.get("purchase_conversions") or 0),
                "purchase_revenue": int(metrics.get("purchase_revenue") or 0),
                "ctr": ctr,
                "cpc": cpc,
                "cvr": cvr,
                "roas": roas,
                "source": source,
            }
        )

    if not records:
        return 0

    with SessionLocal() as session:
        # 동일 날짜/동일 source에 대해 "완전 교체"로 동작하게 한다.
        # (과거 잘못된 파싱/매핑으로 저장된 레코드가 PK가 달라 upsert로는 정리되지 않는 케이스가 있어,
        #  재수집 시에는 기존 source 레코드를 먼저 삭제한 뒤 새로 넣는다.)
        session.query(NaverAdKeywordDaily).filter(
            NaverAdKeywordDaily.date == d,
            NaverAdKeywordDaily.source == source,
        ).delete(synchronize_session=False)

        stmt = insert(NaverAdKeywordDaily).values(records)

        # PK / 생성 시각을 제외한 컬럼들을 upsert 대상 컬럼으로 지정
        update_cols: Iterable[str] = (
            c.name
            for c in NaverAdKeywordDaily.__table__.columns
            if c.name
            not in ("date", "campaign_name", "adgroup_name", "keyword", "device", "created_at")
        )
        upsert_stmt = stmt.on_conflict_do_update(
            index_elements=[
                NaverAdKeywordDaily.date,
                NaverAdKeywordDaily.campaign_name,
                NaverAdKeywordDaily.adgroup_name,
                NaverAdKeywordDaily.keyword,
                NaverAdKeywordDaily.device,
            ],
            set_={col: getattr(stmt.excluded, col) for col in update_cols},
        )
        session.execute(upsert_stmt)
        session.commit()

    return len(records)


def upsert_searchword_daily_from_df(
    df: Any, target_date: str, *, source: str = "searchword_csv"
) -> int:
    """
    `normalize_searchword_report_rows_from_df` 이후 생성된 DataFrame(df_sw_all)을
    `naver_ad_searchword_daily` 테이블에 upsert 한다.
    """
    if df is None or df.empty:
        return 0

    d = _parse_date(target_date)

    records_by_key: dict[tuple[date, str, str, str, str], dict] = {}
    for _, r in df.iterrows():
        campaign = str(r.get("캠페인") or "").strip()
        adgroup = str(r.get("광고 그룹") or "").strip()
        # UI "검색어 보고서"는 (검색어, 키워드) 컬럼이 공존할 수 있다.
        # - searchword: 실제 사용자 검색어
        # - matched_keyword: 매칭된 키워드(피벗/집계에서 사용)
        searchword = str(r.get("검색어") or r.get("searchword") or "").strip()
        matched_keyword = str(r.get("키워드") or r.get("keyword") or "").strip()
        if not searchword and matched_keyword:
            # 일부 업로드는 '검색어'가 없고 '키워드'만 존재할 수 있어 폴백한다.
            searchword = matched_keyword
        if not searchword:
            continue
        if matched_keyword and matched_keyword == searchword:
            # 중복 저장은 피한다(데이터 의미는 유지)
            matched_keyword = ""

        ck_raw = (
            r.get("캠페인유형")
            or r.get("캠페인 유형")
            or r.get("campaign_kind")
            or r.get("campaignKind")
            or ""
        )
        campaign_kind = _normalize_campaign_kind_value(ck_raw)

        impressions = int(r.get("노출수") or 0)
        clicks = int(r.get("클릭수") or 0)
        cost = int(r.get("총비용(원)") or 0)
        metrics = normalize_conversion_metrics(
            target_date=d,
            conversions=int(r.get("전환수") or 0),
            revenue=int(r.get("전환매출액(원)") or 0),
            purchase_conversions=int(r.get("구매전환수") or r.get("purchase_conversions") or 0),
            purchase_revenue=int(r.get("구매전환매출액(원)") or r.get("purchase_revenue") or 0),
        )

        ctr = float(r.get("클릭률(%)") or 0.0)
        cpc = float(r.get("CPC(원)") or 0.0)
        cvr = float(r.get("전환율(%)") or 0.0)
        roas = float(r.get("ROAS(%)") or 0.0)
        if str(metrics.get("conversion_semantics") or "") == "legacy_purchase_only":
            roas = 0.0

        key = (d, campaign, adgroup, searchword, "ALL", source)
        current = records_by_key.get(key)
        if current is None:
            records_by_key[key] = {
                "date": d,
                "campaign_name": campaign,
                "adgroup_name": adgroup,
                "searchword": searchword,
                "matched_keyword": matched_keyword or None,
                "device": "ALL",
                "campaign_kind": campaign_kind,
                "impressions": impressions,
                "clicks": clicks,
                "cost": cost,
                "conversions": int(metrics.get("conversions") or 0),
                "revenue": int(metrics.get("revenue") or 0),
                "conversion_semantics": str(metrics.get("conversion_semantics") or "total_plus_purchase"),
                "purchase_conversions": int(metrics.get("purchase_conversions") or 0),
                "purchase_revenue": int(metrics.get("purchase_revenue") or 0),
                "ctr": ctr,
                "cpc": cpc,
                "cvr": cvr,
                "roas": roas,
                "source": source,
            }
            continue

        current["impressions"] = int(current.get("impressions") or 0) + impressions
        current["clicks"] = int(current.get("clicks") or 0) + clicks
        current["cost"] = int(current.get("cost") or 0) + cost
        current["conversions"] = int(current.get("conversions") or 0) + int(metrics.get("conversions") or 0)
        current["revenue"] = int(current.get("revenue") or 0) + int(metrics.get("revenue") or 0)
        current["purchase_conversions"] = int(current.get("purchase_conversions") or 0) + int(metrics.get("purchase_conversions") or 0)
        current["purchase_revenue"] = int(current.get("purchase_revenue") or 0) + int(metrics.get("purchase_revenue") or 0)
        # 서로 다른 키워드가 같은 searchword 유니크 키에 합쳐지면 특정 키워드로 오해하지 않도록 비운다.
        if (current.get("matched_keyword") or None) != (matched_keyword or None):
            current["matched_keyword"] = None
        if not (current.get("campaign_kind") or "").strip() and campaign_kind:
            current["campaign_kind"] = campaign_kind

    records: list[dict] = []
    for current in records_by_key.values():
        impressions_total = int(current.get("impressions") or 0)
        clicks_total = int(current.get("clicks") or 0)
        cost_total = int(current.get("cost") or 0)
        conversions_total = int(current.get("conversions") or 0)
        revenue_total = int(current.get("revenue") or 0)
        purchase_conversions_total = int(current.get("purchase_conversions") or 0)
        purchase_revenue_total = int(current.get("purchase_revenue") or 0)
        current["ctr"] = (clicks_total / impressions_total * 100.0) if impressions_total > 0 else 0.0
        current["cpc"] = (cost_total / clicks_total) if clicks_total > 0 else 0.0
        current["cvr"] = (conversions_total / clicks_total * 100.0) if clicks_total > 0 else 0.0
        current["roas"] = (revenue_total / cost_total * 100.0) if cost_total > 0 else 0.0
        records.append(current)

    if not records:
        return 0

    with SessionLocal() as session:
        session.query(NaverAdSearchwordDaily).filter(
            NaverAdSearchwordDaily.date == d,
            NaverAdSearchwordDaily.source == source,
        ).delete(synchronize_session=False)

        stmt = insert(NaverAdSearchwordDaily).values(records)

        update_cols: Iterable[str] = (
            c.name
            for c in NaverAdSearchwordDaily.__table__.columns
            if c.name
            not in ("date", "campaign_name", "adgroup_name", "searchword", "device", "source", "created_at")
        )
        upsert_stmt = stmt.on_conflict_do_update(
            index_elements=[
                NaverAdSearchwordDaily.date,
                NaverAdSearchwordDaily.campaign_name,
                NaverAdSearchwordDaily.adgroup_name,
                NaverAdSearchwordDaily.searchword,
                NaverAdSearchwordDaily.device,
                NaverAdSearchwordDaily.source,
            ],
            set_={col: getattr(stmt.excluded, col) for col in update_cols},
        )
        session.execute(upsert_stmt)
        session.commit()

    return len(records)


def upsert_gfa_daily_records(records: list[dict], *, source: str = "gfa_report_upload") -> int:
    """
    GFA 성과보고서 CSV/ZIP에서 정규화한 records를 `naver_gfa_performance_daily`에 upsert한다.

    같은 날짜/source는 다운로드 보고서 결과가 단일 진실이므로 먼저 삭제 후 새로 넣는다.
    """
    if not records:
        return 0

    normalized: list[dict] = []
    delete_dates: set[date] = set()

    def _to_date(v: object) -> date | None:
        if isinstance(v, date):
            return v
        s = str(v or "").strip()
        if not s:
            return None
        try:
            return _parse_date(s)
        except Exception:
            return None

    def _to_int(v: object) -> int:
        try:
            if v is None:
                return 0
            if isinstance(v, bool):
                return int(v)
            if isinstance(v, (int, float)):
                return int(v)
            s = str(v).strip().replace(",", "")
            if not s:
                return 0
            s = re.sub(r"[^\d.\-]", "", s)
            return int(float(s)) if s else 0
        except Exception:
            return 0

    def _to_float(v: object) -> float:
        try:
            f = float(v or 0.0)
            return f if math.isfinite(f) else 0.0
        except Exception:
            return 0.0

    for raw in records:
        d = _to_date(raw.get("date"))
        if d is None:
            continue
        campaign_id = str(raw.get("campaign_id") or "").strip()
        adgroup_id = str(raw.get("adgroup_id") or "").strip()
        creative_id = str(raw.get("creative_id") or "").strip()
        if not creative_id:
            if source.endswith("_campaign"):
                creative_id = "__campaign__:" + (campaign_id or str(raw.get("campaign_name") or "").strip() or "unknown")
            elif source.endswith("_asset_group"):
                creative_id = "__asset_group__:" + (adgroup_id or str(raw.get("adgroup_name") or "").strip() or campaign_id or "unknown")
            else:
                continue
        placement = str(raw.get("placement") or "").strip() or "전체"
        audience = str(raw.get("audience") or "").strip() or "전체"
        results = _to_int(raw.get("results"))
        impressions = _to_int(raw.get("impressions"))
        clicks = _to_int(raw.get("clicks"))
        cost = _to_int(raw.get("cost"))
        conversions = _to_int(raw.get("conversions"))
        revenue = _to_int(raw.get("revenue"))
        cart_conversions = _to_int(raw.get("cart_conversions"))
        cart_revenue = _to_int(raw.get("cart_revenue"))
        purchase_conversions = _to_int(raw.get("purchase_conversions"))
        purchase_revenue = _to_int(raw.get("purchase_revenue"))
        collected_at = datetime.now()

        normalized.append(
            {
                "date": d,
                "campaign_id": campaign_id,
                "adgroup_id": adgroup_id,
                "creative_id": creative_id,
                "placement": placement,
                "audience": audience,
                "campaign_name": str(raw.get("campaign_name") or "").strip(),
                "adgroup_name": str(raw.get("adgroup_name") or "").strip(),
                "creative_name": str(raw.get("creative_name") or "").strip(),
                "result_type": str(raw.get("result_type") or "").strip() or None,
                "cost_per_result_type": str(raw.get("cost_per_result_type") or "").strip() or None,
                "started_on": _to_date(raw.get("started_on")),
                "ended_on": str(raw.get("ended_on") or "").strip() or None,
                "raw_payload_json": json.dumps(raw.get("raw_payload") or {}, ensure_ascii=False, default=str)
                if isinstance(raw.get("raw_payload"), dict)
                else None,
                "collected_at": collected_at,
                "results": results,
                "cost_per_result": _to_float(raw.get("cost_per_result")) if raw.get("cost_per_result") is not None else ((cost / results) if results > 0 else 0.0),
                "impressions": impressions,
                "clicks": clicks,
                "cost": cost,
                "conversions": conversions,
                "revenue": revenue,
                "cart_conversions": cart_conversions,
                "cart_revenue": cart_revenue,
                "purchase_conversions": purchase_conversions,
                "purchase_revenue": purchase_revenue,
                "cpm": _to_float(raw.get("cpm")) if raw.get("cpm") is not None else ((cost / impressions * 1000.0) if impressions > 0 else 0.0),
                "ctr": _to_float(raw.get("ctr")) if raw.get("ctr") is not None else ((clicks / impressions * 100.0) if impressions > 0 else 0.0),
                "cpc": _to_float(raw.get("cpc")) if raw.get("cpc") is not None else ((cost / clicks) if clicks > 0 else 0.0),
                "cvr": _to_float(raw.get("cvr")) if raw.get("cvr") is not None else ((conversions / clicks * 100.0) if clicks > 0 else 0.0),
                "roas": _to_float(raw.get("roas")) if raw.get("roas") is not None else ((revenue / cost * 100.0) if cost > 0 else 0.0),
                "purchase_roas": _to_float(raw.get("purchase_roas")) if raw.get("purchase_roas") is not None else ((purchase_revenue / cost * 100.0) if cost > 0 else 0.0),
                "source": source,
            }
        )
        delete_dates.add(d)

    if not normalized:
        return 0

    with SessionLocal() as session:
        for d in delete_dates:
            session.query(NaverGfaDaily).filter(
                NaverGfaDaily.date == d,
                NaverGfaDaily.source == source,
            ).delete(synchronize_session=False)

        update_cols: list[str] = [
            c.name
            for c in NaverGfaDaily.__table__.columns
            if c.name not in ("date", "campaign_id", "adgroup_id", "creative_id", "placement", "audience", "created_at")
        ]
        chunk_size = 1000
        for i in range(0, len(normalized), chunk_size):
            chunk = normalized[i : i + chunk_size]
            stmt = insert(NaverGfaDaily).values(chunk)
            upsert_stmt = stmt.on_conflict_do_update(
                index_elements=[
                    NaverGfaDaily.date,
                    NaverGfaDaily.campaign_id,
                    NaverGfaDaily.adgroup_id,
                    NaverGfaDaily.creative_id,
                    NaverGfaDaily.placement,
                    NaverGfaDaily.audience,
                ],
                set_={col: getattr(stmt.excluded, col) for col in update_cols},
            )
            session.execute(upsert_stmt)
        session.commit()

    return len(normalized)


def upsert_creative_daily_from_df(
    df: Any,
    target_date: str,
    *,
    source: str = "creative_csv",
    scope_campaigns: list[str] | None = None,
    scope_adgroups: list[str] | None = None,
    delete_mode: str = "auto",  # auto | full | scoped | none
    preserve_metrics_on_conflict: bool = False,
) -> int:
    """
    `naver_ad_creative_daily` 테이블에 upsert 한다.

    기대 컬럼(대표):
      - 캠페인, 광고 그룹, 소재ID, 소재명
      - 노출수, 클릭수, 총비용(원), 전환수, 전환매출액(원)
      - 클릭률(%), 전환율(%), ROAS(%), CPC(원)
      - 현재입찰가, 품질지수, 평균노출순위, 이미지URL, 상품명(선택)
    """
    if df is None or df.empty:
        return 0

    d = _parse_date(target_date)

    def _to_int(v) -> int:
        try:
            if v is None:
                return 0
            if isinstance(v, bool):
                return int(v)
            if isinstance(v, (int, float)):
                return int(v)
            s = str(v).strip()
            if not s:
                return 0
            s = s.replace(",", "")
            s = re.sub(r"[^\d.\-]", "", s)
            if not s:
                return 0
            return int(float(s))
        except Exception:
            return 0

    def _to_float(v) -> float | None:
        try:
            if v is None:
                return None
            if isinstance(v, (int, float)):
                f = float(v)
                return f if math.isfinite(f) else None
            s = str(v).strip()
            if not s:
                return None
            s = s.replace(",", "")
            s = re.sub(r"[^\d.\-]", "", s)
            if not s:
                return None
            f = float(s)
            return f if math.isfinite(f) else None
        except Exception:
            return None

    def _to_device(v) -> str:
        s = str(v or "").strip().lower()
        if not s:
            return "ALL"
        if "모바일" in s or "mobile" in s:
            return "MOBILE"
        if "pc" in s or "desktop" in s:
            return "PC"
        if "전체" in s or "all" in s:
            return "ALL"
        return str(v).strip().upper()[:16]

    records: list[dict] = []
    for _, r in df.iterrows():
        campaign = str(r.get("캠페인") or "").strip()
        adgroup = str(r.get("광고 그룹") or r.get("광고그룹") or "").strip()
        cid = str(r.get("소재ID") or r.get("소재 ID") or r.get("creative_id") or "").strip()
        display_keyword = str(r.get("키워드") or r.get("display_keyword") or r.get("keyword") or "").strip()
        if display_keyword.lower() in {"nan", "none", "null"} or display_keyword == "-":
            display_keyword = ""
        cname = str(r.get("소재명") or r.get("소재") or r.get("creative_name") or "").strip()
        if not cid:
            continue
        if "-01-" in cid and not display_keyword:
            # 파워링크는 키워드 단위가 표준 표시/저장 단위다.
            # 키워드가 없는 row를 저장하면 소재ID 단위 합산 row가 다시 생기므로 제외한다.
            continue

        device = _to_device(r.get("디바이스") or r.get("기기") or r.get("device") or r.get("매체"))

        impressions = _to_int(r.get("노출수") or r.get("impressions"))
        clicks = _to_int(r.get("클릭수") or r.get("clicks"))
        cost = _to_int(r.get("총비용(원)") or r.get("총비용") or r.get("cost"))
        metrics = normalize_conversion_metrics(
            target_date=d,
            conversions=_to_int(r.get("전환수") or r.get("conversions")),
            revenue=_to_int(r.get("전환매출액(원)") or r.get("전환매출") or r.get("revenue")),
            purchase_conversions=_to_int(r.get("구매전환수") or r.get("purchase_conversions")),
            purchase_revenue=_to_int(r.get("구매전환매출액(원)") or r.get("purchase_revenue")),
        )

        ctr = float(r.get("클릭률(%)") or 0.0)
        cpc = float(r.get("CPC(원)") or 0.0)
        cvr = float(r.get("전환율(%)") or 0.0)
        roas = float(r.get("ROAS(%)") or 0.0)
        if str(metrics.get("conversion_semantics") or "") == "legacy_purchase_only":
            roas = 0.0

        current_bid = _to_int(r.get("현재입찰가") or r.get("bid") or r.get("current_bid")) or None
        quality_index = _to_float(r.get("품질지수") or r.get("quality") or r.get("quality_index"))
        avg_rank = _to_float(r.get("평균노출순위") or r.get("avg_rank") or r.get("avgRnk") or r.get("avgRnk"))
        image_url = str(r.get("이미지URL") or r.get("image_url") or "").strip() or None
        product_title = str(r.get("상품명") or r.get("product_title") or "").strip() or None
        # 쇼핑 계열은 소재명이 비어있어도 상품명은 들어오는 경우가 있어, 저장 시 소재명 폴백으로 사용한다.
        if (not cname) and product_title and ("-02-" in cid or "-04-" in cid):
            cname = str(product_title).strip()

        records.append(
            {
                "date": d,
                "campaign_name": campaign,
                "adgroup_name": adgroup,
                "creative_id": cid,
                "display_keyword": display_keyword,
                "device": device,
                "creative_name": cname,
                "product_title": product_title,
                "image_url": image_url,
                "current_bid": current_bid,
                "quality_index": quality_index,
                "avg_rank": avg_rank,
                "impressions": impressions,
                "clicks": clicks,
                "cost": cost,
                "conversions": int(metrics.get("conversions") or 0),
                "revenue": int(metrics.get("revenue") or 0),
                "conversion_semantics": str(metrics.get("conversion_semantics") or "total_plus_purchase"),
                "purchase_conversions": int(metrics.get("purchase_conversions") or 0),
                "purchase_revenue": int(metrics.get("purchase_revenue") or 0),
                "ctr": float(ctr or 0.0),
                "cpc": float(cpc or 0.0),
                "cvr": float(cvr or 0.0),
                "roas": float(roas or 0.0),
                "source": source,
            }
        )

    if not records:
        return 0

    # 한 번의 upsert statement 내에서 동일 PK 중복이 있으면 Postgres가 CardinalityViolation을 발생시킨다.
    records = _dedupe_creative_daily_records(records)

    with SessionLocal() as session:
        # NOTE:
        # SearchAd stat-reports는 0노출/0클릭 소재를 반환하지 않는 경우가 있어,
        # delete 후 insert 방식은 "메타갱신 후 소재가 줄어드는" 누락을 유발할 수 있다.
        #
        # 정책:
        # - 기본(auto)은 "none"(delete 없이 upsert)로 동작한다.
        # - 일자 단위로 강제 초기화가 필요하면 /ads/purge(삭제키)로 수행한다.
        mode = str(delete_mode or "auto").strip().lower()
        if mode == "auto":
            mode = "none"
        if mode == "full":
            session.query(NaverAdCreativeDaily).filter(
                NaverAdCreativeDaily.date == d,
                NaverAdCreativeDaily.source == source,
            ).delete(synchronize_session=False)
        elif mode == "scoped":
            q = session.query(NaverAdCreativeDaily).filter(
                NaverAdCreativeDaily.date == d,
                NaverAdCreativeDaily.source == source,
            )
            if scope_campaigns:
                q = q.filter(NaverAdCreativeDaily.campaign_name.in_(list(scope_campaigns)))
            if scope_adgroups:
                q = q.filter(NaverAdCreativeDaily.adgroup_name.in_(list(scope_adgroups)))
            q.delete(synchronize_session=False)
        else:
            # none: delete 없이 upsert만 수행
            pass

        if any(str(r.get("display_keyword") or "").strip() for r in records):
            # 파워링크 키워드별 저장 전환 후, 과거 소재ID 단위 합산 row(display_keyword='')가 남아 있으면
            # UI에서 같은 소재가 합산 row + 키워드 row로 중복 표시된다. 같은 날짜/범위의 파워링크 합산 row만 제거한다.
            cleanup_q = session.query(NaverAdCreativeDaily).filter(
                NaverAdCreativeDaily.date == d,
                NaverAdCreativeDaily.source == source,
                NaverAdCreativeDaily.display_keyword == "",
            )
            if scope_campaigns:
                cleanup_q = cleanup_q.filter(NaverAdCreativeDaily.campaign_name.in_(list(scope_campaigns)))
            if scope_adgroups:
                cleanup_q = cleanup_q.filter(NaverAdCreativeDaily.adgroup_name.in_(list(scope_adgroups)))
            cleanup_q = cleanup_q.filter(
                (NaverAdCreativeDaily.creative_id.like("%-01-%"))
                | (NaverAdCreativeDaily.campaign_name.like("#SA%"))
                | (NaverAdCreativeDaily.campaign_name.like("SA%"))
                | (NaverAdCreativeDaily.campaign_name.like("%파워링크%"))
            )
            cleanup_q.delete(synchronize_session=False)

        stmt = insert(NaverAdCreativeDaily).values(records)

        excluded = stmt.excluded
        # 부분 수집/업로드(예: 소재 보고서 CSV)는 메타(소재명/상품명/이미지/입찰가/품질지수)를 포함하지 않을 수 있다.
        # 이 때 upsert가 기존 메타를 빈 값(None/"")으로 덮어쓰면 UI 품질이 급격히 떨어진다.
        #
        # 정책:
        # - 지표(노출/클릭/비용/전환/ROAS 등)는 "새 값으로 덮어쓰기"
        # - 메타는 "유효한 새 값이 있을 때만 덮어쓰기" (없으면 기존 유지)
        def _keep_if_blank_str(col_name: str):
            col = getattr(NaverAdCreativeDaily, col_name)
            ex = getattr(excluded, col_name)
            return case((ex.isnot(None) & (ex != ""), ex), else_=col)

        def _keep_if_positive(col_name: str):
            col = getattr(NaverAdCreativeDaily, col_name)
            ex = getattr(excluded, col_name)
            return case((ex.isnot(None) & (ex > 0), ex), else_=col)

        # 소재명은 업로드 CSV에서 종종 "소재ID"로 들어온다 → 그 경우는 기존 값을 유지한다.
        creative_name_set = case(
            (
                (excluded.creative_name.isnot(None))
                & (excluded.creative_name != "")
                & (excluded.creative_name != excluded.creative_id),
                excluded.creative_name,
            ),
            else_=NaverAdCreativeDaily.creative_name,
        )

        set_map = {
            # 메타(유효할 때만 갱신)
            "creative_name": creative_name_set,
            "product_title": _keep_if_blank_str("product_title"),
            "image_url": _keep_if_blank_str("image_url"),
            "display_keyword": excluded.display_keyword,
            "current_bid": _keep_if_positive("current_bid"),
            "quality_index": _keep_if_positive("quality_index"),
            "avg_rank": _keep_if_positive("avg_rank"),
            # 지표(항상 덮어쓰기)
            "impressions": excluded.impressions,
            "clicks": excluded.clicks,
            "cost": excluded.cost,
            "conversions": excluded.conversions,
            "revenue": excluded.revenue,
            "purchase_conversions": excluded.purchase_conversions,
            "purchase_revenue": excluded.purchase_revenue,
            "ctr": excluded.ctr,
            "cpc": excluded.cpc,
            "cvr": excluded.cvr,
            "roas": excluded.roas,
            # 최신 출처로 갱신(디버깅/추적)
            "source": excluded.source,
        }
        if preserve_metrics_on_conflict:
            set_map.update(
                {
                    # 구매 전환 헤더가 없는 과거/부분 리포트 보강 시에는 실적 지표를 보존한다.
                    "impressions": NaverAdCreativeDaily.impressions,
                    "clicks": NaverAdCreativeDaily.clicks,
                    "cost": NaverAdCreativeDaily.cost,
                    "conversions": NaverAdCreativeDaily.conversions,
                    "revenue": NaverAdCreativeDaily.revenue,
                    "purchase_conversions": NaverAdCreativeDaily.purchase_conversions,
                    "purchase_revenue": NaverAdCreativeDaily.purchase_revenue,
                    "ctr": NaverAdCreativeDaily.ctr,
                    "cpc": _keep_if_positive("cpc"),
                    "cvr": NaverAdCreativeDaily.cvr,
                    "roas": NaverAdCreativeDaily.roas,
                    "source": excluded.source,
                }
            )
        upsert_stmt = stmt.on_conflict_do_update(
            index_elements=[
                NaverAdCreativeDaily.date,
                NaverAdCreativeDaily.campaign_name,
                NaverAdCreativeDaily.adgroup_name,
                NaverAdCreativeDaily.creative_id,
                NaverAdCreativeDaily.display_keyword,
                NaverAdCreativeDaily.device,
            ],
            set_=set_map,
        )
        session.execute(upsert_stmt)
        session.commit()

    return len(records)
