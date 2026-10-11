from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

from gfa_existing_product_object_extraction import (  # noqa: E402
    extract_existing_product_from_flattened_source,
    save_extraction_case_artifacts,
    build_review_sheet,
    segmentation_primitive_status,
)


def main() -> None:
    review_root = ROOT / "calibration" / "review" / "gfa-existing-product-object-extraction-implementation-v1"
    case1 = review_root / "cases" / "case1-two-pouch-group"
    primitive = segmentation_primitive_status()
    print(json.dumps({"primitive": primitive}, ensure_ascii=False))
    result = extract_existing_product_from_flattened_source(
        source_path=case1 / "source.png",
        user_selection_path=case1 / "user-selection-mask.png",
    )
    save_extraction_case_artifacts(result, case1)
    identity = result.get("identity") or {}
    print(
        json.dumps(
            {
                "ok": result.get("ok"),
                "decisionHint": result.get("decisionHint"),
                "components": (result.get("existingProductExtraction") or {}).get("productGroupComponentCount"),
                "identity": identity,
                "area": result.get("area"),
                "guards": result.get("guards"),
                "searchRoi": result.get("searchRoi"),
            },
            ensure_ascii=False,
        )
    )
    if result.get("ok"):
        build_review_sheet([case1], review_root / "runtime-qa-review-sheet.png")


if __name__ == "__main__":
    main()
