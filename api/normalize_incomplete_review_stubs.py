import argparse
import json

import main
from db import SessionLocal


def run() -> int:
    parser = argparse.ArgumentParser(description="Normalize incomplete smartstore product-page review stubs.")
    parser.add_argument("--limit", type=int, default=500, help="Maximum stub rows to scan in one run")
    args = parser.parse_args()

    with SessionLocal() as db:
        result = main._cleanup_incomplete_product_page_review_stubs(db, limit=args.limit)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
